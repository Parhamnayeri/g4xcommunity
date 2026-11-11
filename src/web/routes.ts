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
  reactivateCharacter,
  getCharacterDetails,
} from '../services/characterService';
import {
  previewRaiderIOProfile,
  RAIDERIO_ATTRIBUTION,
} from '../services/raiderio';
import {
  createTeam,
  listTeams,
  inviteMember,
  acceptInvitation,
  declineInvitation,
  leaveTeam,
  disbandTeam,
} from '../services/teamService';
import { DomainError, DomainErrorCode } from '../services/domainErrors';
import { getOrCreateWalletV2, getWalletV2Summary } from '../services/financeV2/financeV2WalletService';
import { marketplaceRouter } from './marketplaceRoutes';
import { paymentRouter } from './paymentRoutes';
import { walletRouter } from './walletRoutes';
import { operationsRouter } from './operationsRoutes';
import { getGlobalDiscordClient } from '../services/orderDiscordService';
import {
  getOrderDiagnostics,
  getCategorizedOrders,
  publishOrder,
  payOrderFromWallet,
  cancelOrderWithLifecycle,
  getOrderAuditHistory,
  getSeparatedOrdersList,
  createAdvertiserBoostOrder,
  classifyOrderOrigin,
} from '../services/orderLifecycleService';
import { verifyOrderWithReceipt } from '../services/payment/paymentReconciliationService';
import {
  generateUsdtWithdrawalQuote,
  generateIrtWithdrawalQuote,
  createWithdrawalRequestFromQuote,
  confirmAndSubmitWithdrawalRequest,
  boosterCancelWithdrawal,
  adminExecuteManualPayout,
  adminApproveWithdrawalForProcessing,
  adminRejectWithdrawal,
  updateWithdrawalMetadata,
  getWithdrawalAuditHistory,
} from '../services/financeV2/boosterWithdrawalService';
import {
  serializeUserWithdrawal,
  serializeAdminWithdrawal,
} from './serializers';
import {
  recordProofSubmitted,
  recordStaffReview,
  recordAdminFinalApproval,
  executeG4XBoostRelease,
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
  openOrderDispute,
  requestDisputeEvidence,
  submitDisputeEvidence,
  addDisputeReviewNotes,
  resolveOrderDispute,
  submitRunProof,
  reviewRunProof,
  getDisputesForUser,
  formatDisputeStatusLabel,
} from '../services/orderDisputeService';
import {
  mapOrderStatus,
  mapGoldTradeStatus,
  mapWithdrawalStatus,
  mapApplicationStatus,
} from '../services/statusSimplifier';
import { createExternalOrder } from '../services/platformOrderService';
import {
  listAdminGames,
  createGame,
  updateGame,
  toggleGameStatus,
  reorderGames,
  deleteGame,
  createGameService,
  updateGameService,
  toggleGameServiceStatus,
  reorderGameServices,
  deleteGameService,
} from '../services/gameManagementService';
import {
  provisionAllChannels,
  reconcileChannelMappings,
  validateDiscordChannel,
  updateChannelMapping,
  repairChannelMapping,
  toggleChannelMappingStatus,
  listChannelMappings,
} from '../services/discordProvisioningService';
import { resolveExecutionGuild } from '../services/orderExecutionChannelService';
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
import {
  getPlatformAccountsSummary,
  checkPlatformWithdrawalEligibility,
  getOrCreatePlatformAccount,
  ExternalPlatform,
} from '../services/platformBalanceService';
import {
  createDraftWithdrawalBatch,
  markBatchReady,
  submitWithdrawalBatch,
  cancelWithdrawalBatch,
  recordBatchReceipt,
  reconcileWithdrawalBatch,
} from '../services/withdrawalBatchService';
import {
  getPlatformWithdrawalThreshold,
  getPlatformWithdrawalThresholdAsync,
} from '../services/financialPolicyService';
import {
  finalizeOrderFinancialsAndBoosterAllocation,
  splitPoolEquallyWithRemainder,
  allocateProportionalWithRemainder,
} from '../services/financialCalculationEngine';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import {
  listAdminUsers,
  getAdminUserProfile,
  updateUserAccountStatus,
  assignOrRevokeUserRole,
  deleteUserSafely,
  getUserAuditLogs,
  getUserBanHistory,
} from '../services/adminUserService';
import { validateIranianIban, maskIban, maskCryptoAddress } from '../services/financeV2/iranianIbanValidator';
import { validateBep20Address } from '../services/financeV2/bep20Validator';
import { FINANCE_V2_CONSTANTS, BoosterWithdrawalMethod, BoosterWithdrawalStatus } from '../services/financeV2/financeV2Types';

import { ownerGateRouter } from './ownerGate';
import { adminPortalRouter } from './adminPortalRoutes';
import { ownerPortalRouter } from './ownerPortalRoutes';
import { profileSettingsRouter } from './profileSettingsRoutes';
import { policyRouter } from './policyRoutes';
import { discordCommandsRouter } from './discordCommandsRoutes';

export const router = Router();

// ─── دروازه ورود اختصاصی و امن مالک (OwnerGate) ─────────────────────────────
router.use('/OwnerGate', ownerGateRouter);
router.use('/ownergate', ownerGateRouter);

// ─── روت‌های پورتال ادمین و مالک (Website Phase 8) ──────────────────────────
router.use('/', adminPortalRouter);
router.use('/', ownerPortalRouter);
router.use('/', policyRouter);
router.use('/', discordCommandsRouter);

// ─── روت‌های پروفایل کاربر، تنظیمات و پورتال بوستر (Website Phase 9) ─────────
router.use('/', profileSettingsRouter);

// ─── روت‌های بازار مبادله، معاملات طلا و شارژ همتا‌به‌همتا (Finance V2.2) ──────
router.use('/marketplace', marketplaceRouter);

// ─── روت‌های پرداخت، وب‌هوک و اعتبارسنجی وصول وجوه ─────────────────────────
router.use('/', paymentRouter);
router.use('/', walletRouter);
router.use('/', operationsRouter);
router.use('/operations', operationsRouter);

// ─── کاتالوگ عمومی بازی‌ها و سرویس‌های فعال پلتفرم G4X ─────────────────────
router.get('/public/games', async (_req: Request, res: Response): Promise<void> => {
  try {
    const activeGames = await prisma.game.findMany({
      where: { isActive: true },
      include: {
        services: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const bookingDestination =
      process.env.BOOKING_URL ||
      (process.env.DISCORD_GUILD_ID && process.env.CHANNEL_ORDERS
        ? `https://discord.com/channels/${process.env.DISCORD_GUILD_ID}/${process.env.CHANNEL_ORDERS}`
        : '/legacy');

    const discordInviteUrl =
      process.env.DISCORD_INVITE_URL ||
      (process.env.DISCORD_GUILD_ID
        ? `https://discord.com/channels/${process.env.DISCORD_GUILD_ID}`
        : '/auth/discord');

    res.json({
      success: true,
      games: activeGames,
      config: {
        discordGuildId: process.env.DISCORD_GUILD_ID,
        discordInviteUrl,
        bookingDestination,
        channels: {
          orders: process.env.CHANNEL_ORDERS,
          becomeBooster: process.env.CHANNEL_BECOME_BOOSTER,
          becomeAdvertiser: process.env.CHANNEL_BECOME_ADVERTISER,
          becomeExchanger: process.env.CHANNEL_BECOME_EXCHANGER,
        },
      },
    });
  } catch (err: any) {
    console.error('[Public API] Error fetching games catalog:', err);
    res.status(500).json({ error: 'Failed to retrieve active games catalog' });
  }
});

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

// ─── داشبورد کاربری React (Phase 2 Authenticated Dashboard Overview) ──────────
router.get('/dashboard/overview', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;

    // ۱. خلاصه والت معتبر نسل دوم
    const walletSummary = await getWalletV2Summary(user.discordId);

    // ۲. اطلاعات پروفایل، نقش‌ها، درخواست عضویت و تاییدیه‌ها
    const [latestApp, approvals, userWithRoles] = await Promise.all([
      prisma.registrationApplication.findFirst({
        where: { userId: user.discordId },
        orderBy: { submittedAt: 'desc' },
      }),
      prisma.userGameApproval.findMany({
        where: { userId: user.discordId, status: 'approved' },
        include: { game: { select: { displayName: true } } },
      }),
      prisma.user.findUnique({
        where: { discordId: user.discordId },
        include: { userRoles: true },
      }),
    ]);

    const roles = (userWithRoles?.userRoles || []).map((r) => r.roleKey);

    // ۳. سفارش‌های فعال مجاز برای کاربر جاری
    const activeStatuses = ['open_presign', 'presign_closed', 'assigned', 'in_progress', 'disputed'];
    const activeOrdersRaw = await prisma.order.findMany({
      where: {
        AND: [
          {
            OR: [
              { assignments: { some: { userId: user.discordId } } },
              { customerId: user.discordId },
              { advertiserId: user.discordId },
              { creatorId: user.discordId },
            ],
          },
          { status: { in: activeStatuses } },
        ],
      },
      include: {
        game: { select: { slug: true, displayName: true } },
        service: { select: { serviceKey: true, displayName: true, serviceMode: true } },
        assignments: {
          where: { userId: user.discordId },
          select: { assignedRole: true, status: true, assignedAt: true },
        },
        runs: {
          select: { runNumber: true, status: true, completedAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const activeOrders = await Promise.all(
      activeOrdersRaw.map(async (o) => {
        const isBooster = o.assignments.length > 0;
        const isCustomer = o.customerId === user.discordId;
        const isAdvertiser = o.advertiserId === user.discordId;
        const userRelation = isBooster ? 'booster' : isCustomer ? 'customer' : isAdvertiser ? 'advertiser' : 'creator';

        let channelUrl: string | null = null;
        if (o.executionChannelId) {
          try {
            const channelAccess = await getAuthorizedChannelAccess(o.id, user.discordId);
            if (channelAccess.authorized && channelAccess.hasChannel && channelAccess.channelUrl) {
              channelUrl = channelAccess.channelUrl;
            }
          } catch {
            // عدم افشای خطا یا لینک در صورت عدم دسترسی
          }
        }

        return {
          id: o.id,
          orderRef: o.orderRef,
          gameSlug: o.game.slug,
          gameDisplayName: o.game.displayName,
          serviceDisplayName: o.service.displayName,
          orderMode: o.orderMode,
          status: o.status,
          userRelation,
          assignmentRole: o.assignments[0]?.assignedRole || null,
          assignmentStatus: o.assignments[0]?.status || null,
          payoutCents: isBooster ? o.boosterPoolMinor : o.grossAmountMinor,
          payoutUsd: ((isBooster ? o.boosterPoolMinor : o.grossAmountMinor) / 100).toFixed(2),
          channelUrl,
          runsCount: o.runs.length,
          completedRunsCount: o.runs.filter((r: { status: string }) => r.status === 'completed' || r.status === 'verified').length,
          createdAt: o.createdAt,
        };
      })
    );

    // ۴. شمارنده‌های کلی
    const [activeOrdersCount, completedOrdersCount, totalTxCount] = await Promise.all([
      prisma.order.count({
        where: {
          AND: [
            {
              OR: [
                { assignments: { some: { userId: user.discordId } } },
                { customerId: user.discordId },
                { advertiserId: user.discordId },
                { creatorId: user.discordId },
              ],
            },
            { status: { in: activeStatuses } },
          ],
        },
      }),
      prisma.order.count({
        where: {
          AND: [
            {
              OR: [
                { assignments: { some: { userId: user.discordId } } },
                { customerId: user.discordId },
                { advertiserId: user.discordId },
                { creatorId: user.discordId },
              ],
            },
            { status: 'completed' },
          ],
        },
      }),
      prisma.ledgerEntryV2.count({
        where: { userId: user.discordId },
      }),
    ]);

    // مبلغ ناخالص واجد شرایط جهت درخواست پیش از کارمزد متناسب با روش انتخابی
    // کارمزد روش تتر ۴۰ سنت و کارمزد حواله تومانی ۱.۳۰ دلار است که حین درخواست کسر می‌گردد
    const eligibleWithdrawalCents = walletSummary.availableCents;

    res.json({
      success: true,
      profile: {
        discordId: user.discordId,
        username: user.username,
        displayName: user.displayName,
        roles,
        advertiserRank: user.advertiserRank,
        registrationStatus: latestApp?.status || 'none',
        registrationCategory: latestApp?.category || null,
        approvedGames: approvals.map((a) => ({
          gameSlug: a.gameSlug,
          gameName: a.game.displayName,
          approvalType: a.approvalType,
        })),
        createdAt: user.createdAt,
      },
      wallet: {
        availableCents: walletSummary.availableCents,
        availableUsd: (walletSummary.availableCents / 100).toFixed(2),
        reservedCents: walletSummary.reservedCents,
        reservedUsd: (walletSummary.reservedCents / 100).toFixed(2),
        pendingEarningsCents: walletSummary.pendingEarningsCents,
        pendingEarningsUsd: (walletSummary.pendingEarningsCents / 100).toFixed(2),
        confirmedEarningsCents: walletSummary.confirmedEarningsCents,
        confirmedEarningsUsd: (walletSummary.confirmedEarningsCents / 100).toFixed(2),
        paidCents: walletSummary.paidCents,
        paidUsd: (walletSummary.paidCents / 100).toFixed(2),
        totalPaidCents: walletSummary.paidCents,
        totalPaidUsd: (walletSummary.paidCents / 100).toFixed(2),
        refundedCents: walletSummary.refundedCents,
        refundedUsd: (walletSummary.refundedCents / 100).toFixed(2),
        totalHeldCents: walletSummary.totalHeldCents,
        totalHeldUsd: (walletSummary.totalHeldCents / 100).toFixed(2),
        lifetimeEarnedCents: walletSummary.lifetimeEarnedCents,
        lifetimeEarnedUsd: (walletSummary.lifetimeEarnedCents / 100).toFixed(2),
        eligibleWithdrawalCents,
        eligibleWithdrawalUsd: (eligibleWithdrawalCents / 100).toFixed(2),
      },
      activeOrders,
      counts: {
        activeOrdersCount,
        completedOrdersCount,
        totalTransactionsCount: totalTxCount,
      },
    });
  } catch (err: any) {
    console.error('[Dashboard API] Failed to fetch overview:', err);
    res.status(500).json({ error: 'Failed to retrieve dashboard overview' });
  }
});

// ─── تاریخچه سفارش‌های کاربر جاری با صفحه‌بندی و فیلتر ─────────────────────
router.get('/dashboard/orders/history', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10)));
    const offset = (page - 1) * limit;

    const statusFilter = req.query.status ? String(req.query.status) : undefined;
    const gameSlugFilter = req.query.gameSlug ? String(req.query.gameSlug) : undefined;

    const whereStatuses = statusFilter && ['completed', 'cancelled'].includes(statusFilter)
      ? [statusFilter]
      : ['completed', 'cancelled'];

    const whereClause: any = {
      AND: [
        {
          OR: [
            { assignments: { some: { userId: user.discordId } } },
            { customerId: user.discordId },
            { advertiserId: user.discordId },
            { creatorId: user.discordId },
          ],
        },
        { status: { in: whereStatuses } },
      ],
    };

    if (gameSlugFilter && gameSlugFilter !== 'all') {
      whereClause.AND.push({ gameSlug: gameSlugFilter });
    }

    const [ordersRaw, total] = await Promise.all([
      prisma.order.findMany({
        where: whereClause,
        include: {
          game: { select: { slug: true, displayName: true } },
          service: { select: { serviceKey: true, displayName: true } },
          assignments: {
            where: { userId: user.discordId },
            select: { assignedRole: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.order.count({ where: whereClause }),
    ]);

    const orders = ordersRaw.map((o) => {
      const isBooster = o.assignments.length > 0;
      const isCustomer = o.customerId === user.discordId;
      const isAdvertiser = o.advertiserId === user.discordId;
      const userRelation = isBooster ? 'booster' : isCustomer ? 'customer' : isAdvertiser ? 'advertiser' : 'creator';

      return {
        id: o.id,
        orderRef: o.orderRef,
        gameSlug: o.game.slug,
        gameDisplayName: o.game.displayName,
        serviceDisplayName: o.service.displayName,
        orderMode: o.orderMode,
        status: o.status,
        userRelation,
        amountCents: isBooster ? o.boosterPoolMinor : o.grossAmountMinor,
        amountUsd: ((isBooster ? o.boosterPoolMinor : o.grossAmountMinor) / 100).toFixed(2),
        currency: o.currency,
        completedAt: o.completedAt,
        createdAt: o.createdAt,
      };
    });

    res.json({
      success: true,
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('[Dashboard API] Failed to fetch order history:', err);
    res.status(500).json({ error: 'Failed to retrieve order history' });
  }
});

// ─── تاریخچه تراکنش‌های والت دلاری کاربر جاری (LedgerEntryV2 Activity) ──────
router.get('/dashboard/transactions', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10)));
    const offset = (page - 1) * limit;

    const [entriesRaw, total] = await Promise.all([
      prisma.ledgerEntryV2.findMany({
        where: { userId: user.discordId },
        include: {
          order: { select: { orderRef: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.ledgerEntryV2.count({
        where: { userId: user.discordId },
      }),
    ]);

    const transactions = entriesRaw.map((e) => ({
      id: e.id,
      entryRef: e.entryRef,
      entryType: e.entryType,
      direction: e.direction,
      amountCents: e.amountCents,
      amountUsd: (e.amountCents / 100).toFixed(2),
      balanceAfterAvailableCents: e.balanceAfterAvailableCents,
      balanceAfterAvailableUsd:
        e.balanceAfterAvailableCents !== null ? (e.balanceAfterAvailableCents / 100).toFixed(2) : null,
      balanceAfterReservedCents: e.balanceAfterReservedCents,
      balanceAfterReservedUsd:
        e.balanceAfterReservedCents !== null ? (e.balanceAfterReservedCents / 100).toFixed(2) : null,
      description: e.description,
      orderRef: e.order?.orderRef || null,
      createdAt: e.createdAt,
    }));

    res.json({
      success: true,
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('[Dashboard API] Failed to fetch transactions:', err);
    res.status(500).json({ error: 'Failed to retrieve financial transactions' });
  }
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
    const includeInactive = req.query.includeInactive === 'true';
    const characters = await listUserCharacters(user.discordId, { includeInactive });
    res.json(characters.map(serializeCharacter));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list characters' });
  }
});

router.get('/characters/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const characterId = req.params.id;
    if (!characterId) {
      res.status(400).json({ error: 'Valid characterId required.' });
      return;
    }

    const details = await getCharacterDetails(characterId, user.discordId, user.discordId);
    res.json({
      success: true,
      character: serializeCharacter(details),
      cooldownRemainingSeconds: details.refreshCooldown.remainingSeconds,
      canRefresh: details.refreshCooldown.allowed,
      recentRuns: details.recentRuns,
      attribution: RAIDERIO_ATTRIBUTION,
    });
  } catch (err: any) {
    const status = err instanceof DomainError ? 400 : 500;
    res.status(status).json({ error: err.message || 'Failed to get character details' });
  }
});

router.post(
  '/characters/preview',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { url, region, realm, characterName } = req.body;
      const preview = await previewRaiderIOProfile({ url, region, realm, characterName });
      res.json({
        success: true,
        preview,
        attribution: RAIDERIO_ATTRIBUTION,
      });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to preview Raider.IO profile' });
    }
  }
);

router.post(
  '/characters/add',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { characterName, realm, region, raiderioUrl } = req.body;

      if (!raiderioUrl && (!characterName || !realm)) {
        res.status(400).json({ error: 'Either raiderioUrl or both characterName and realm are required.' });
        return;
      }

      const character = await addCharacter({
        userId: user.discordId,
        characterName: characterName || '',
        realm: realm || '',
        region,
        raiderioUrl,
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
  '/characters/reactivate',
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

      const reactivated = await reactivateCharacter(characterId, user.discordId, user.discordId);
      res.json({ success: true, character: serializeCharacter(reactivated) });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to reactivate character' });
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

// ─── خلاصه وضعیت مالی و تسویه حساب بوستر (Withdrawal Overview) ───────────
const handleWithdrawalsOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;

    const [walletSummary, activeWithdrawalsRaw, adminRateConfig, cutoffConfig, pref] = await Promise.all([
      getWalletV2Summary(user.discordId),
      prisma.boosterWithdrawalRequest.findMany({
        where: {
          boosterId: user.discordId,
          status: {
            in: [
              BoosterWithdrawalStatus.QUOTED,
              BoosterWithdrawalStatus.USER_CONFIRMED,
              BoosterWithdrawalStatus.REQUESTED,
              BoosterWithdrawalStatus.RESERVED,
              BoosterWithdrawalStatus.UNDER_ADMIN_REVIEW,
              BoosterWithdrawalStatus.PROCESSING,
            ],
          },
        },
        select: { requestedUsdCents: true },
      }),
      prisma.systemFinancialConfig.findUnique({ where: { key: 'admin_usd_irt_rate' } }),
      prisma.systemFinancialConfig.findUnique({ where: { key: 'irt_payout_tuesday_cutoff_hour' } }),
      prisma.userPayoutPreference.findUnique({ where: { userId: user.discordId } }),
    ]);

    const pendingWithdrawalRequestsCents = activeWithdrawalsRaw.reduce(
      (sum, r) => sum + r.requestedUsdCents,
      0
    );

    const adminUsdIrtRate = adminRateConfig?.value ? Number(adminRateConfig.value) : null;
    const irtRateDiscount = FINANCE_V2_CONSTANTS.BOOSTER_IRT_RATE_DISCOUNT_PER_USD; // 3000
    const effectiveIrtRate = adminUsdIrtRate !== null && adminUsdIrtRate > irtRateDiscount
      ? adminUsdIrtRate - irtRateDiscount
      : null;
    const irtTuesdayCutoffHour = cutoffConfig?.value ? Number(cutoffConfig.value) : null;
    const livePayoutsEnabled = process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED === 'true';

    res.json({
      success: true,
      wallet: {
        availableCents: walletSummary.availableCents,
        availableUsd: (walletSummary.availableCents / 100).toFixed(2),
        reservedCents: walletSummary.reservedCents,
        reservedUsd: (walletSummary.reservedCents / 100).toFixed(2),
        pendingEarningsCents: walletSummary.pendingEarningsCents,
        pendingEarningsUsd: (walletSummary.pendingEarningsCents / 100).toFixed(2),
        confirmedEarningsCents: walletSummary.confirmedEarningsCents,
        confirmedEarningsUsd: (walletSummary.confirmedEarningsCents / 100).toFixed(2),
        totalPaidCents: walletSummary.paidCents,
        totalPaidUsd: (walletSummary.paidCents / 100).toFixed(2),
        pendingWithdrawalRequestsCents,
        pendingWithdrawalRequestsUsd: (pendingWithdrawalRequestsCents / 100).toFixed(2),
        eligibleWithdrawalCents: walletSummary.availableCents,
        eligibleWithdrawalUsd: (walletSummary.availableCents / 100).toFixed(2),
      },
      policy: {
        usdtBep20FeeCents: FINANCE_V2_CONSTANTS.BOOSTER_USDT_WITHDRAWAL_FEE_CENTS, // 40
        usdtBep20FeeUsd: '0.40',
        irtBankFeeCents: FINANCE_V2_CONSTANTS.BOOSTER_IRT_WITHDRAWAL_FEE_CENTS, // 130
        irtBankFeeUsd: '1.30',
        adminUsdIrtRate,
        irtRateDiscount,
        effectiveIrtRate,
        irtTuesdayCutoffHour,
        livePayoutsEnabled,
        scheduleSummary: 'Wednesday and Saturday manual batch disbursements. Tuesday morning cutoff applies for IRT.',
      },
      payoutPreference: pref
        ? {
            bankAccountHolder: pref.bankAccountHolder,
            bankIban: pref.bankIban,
            maskedBankIban: pref.bankIban ? maskIban(pref.bankIban) : null,
            cryptoAddress: pref.cryptoAddress,
            maskedCryptoAddress: pref.cryptoAddress ? maskCryptoAddress(pref.cryptoAddress) : null,
            cryptoNetwork: pref.cryptoNetwork || 'BNB_SMART_CHAIN_BEP20',
            updatedAt: pref.updatedAt,
          }
        : null,
    });
  } catch (err: any) {
    console.error('[Withdrawal API] Overview retrieval error:', err);
    res.status(500).json({ error: 'Failed to retrieve withdrawal overview' });
  }
};

router.get('/withdrawals/overview', requireAuth, handleWithdrawalsOverview);
router.get('/api/withdrawals/overview', requireAuth, handleWithdrawalsOverview);

// ─── دریافت اطلاعات مقصد تسویه ذخیره‌شده (Get Saved Payout Preferences) ──────
const handleGetPayoutPreferences = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const pref = await prisma.userPayoutPreference.findUnique({
      where: { userId: user.discordId },
    });

    res.json({
      success: true,
      preference: pref
        ? {
            bankAccountHolder: pref.bankAccountHolder,
            bankIban: pref.bankIban,
            maskedBankIban: pref.bankIban ? maskIban(pref.bankIban) : null,
            cryptoAddress: pref.cryptoAddress,
            maskedCryptoAddress: pref.cryptoAddress ? maskCryptoAddress(pref.cryptoAddress) : null,
            cryptoNetwork: pref.cryptoNetwork || 'BNB_SMART_CHAIN_BEP20',
            updatedAt: pref.updatedAt,
          }
        : null,
    });
  } catch (err: any) {
    console.error('[PayoutPreference API] Get error:', err);
    res.status(500).json({ error: 'Failed to fetch payout preferences' });
  }
};

router.get('/payout-preferences', requireAuth, handleGetPayoutPreferences);
router.get('/api/payout-preferences', requireAuth, handleGetPayoutPreferences);

// ─── به‌روزرسانی مقاصد تسویه حساب کاربری (Update Saved Payout Preferences) ──
const handleUpdatePayoutPreferences = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const { bankAccountHolder, bankIban, cryptoAddress, cryptoNetwork } = req.body;

    let normalizedBankHolder: string | null = null;
    let normalizedIban: string | null = null;
    let normalizedCrypto: string | null = null;
    const network = cryptoNetwork ? String(cryptoNetwork).trim() : 'BNB_SMART_CHAIN_BEP20';

    // اعتبارسنجی نام صاحب حساب
    if (bankAccountHolder !== undefined && bankAccountHolder !== null && String(bankAccountHolder).trim() !== '') {
      const trimmedHolder = String(bankAccountHolder).trim();
      if (trimmedHolder.length < 3 || trimmedHolder.length > 100) {
        res.status(400).json({ error: 'Account holder name must be between 3 and 100 characters' });
        return;
      }
      normalizedBankHolder = trimmedHolder;
    }

    // اعتبارسنجی شماره شبای بانکی در صورت ارسال
    if (bankIban !== undefined && bankIban !== null && String(bankIban).trim() !== '') {
      const ibanValidation = validateIranianIban(String(bankIban));
      if (!ibanValidation.isValid) {
        res.status(400).json({ error: ibanValidation.error || 'Invalid Iranian IBAN (Sheba)' });
        return;
      }
      normalizedIban = ibanValidation.normalizedIban;
    }

    // اعتبارسنجی آدرس کریپتو BEP-20 در صورت ارسال
    if (cryptoAddress !== undefined && cryptoAddress !== null && String(cryptoAddress).trim() !== '') {
      try {
        const bep20Validation = validateBep20Address(String(cryptoAddress).trim());
        if (!bep20Validation.isValid) {
          res.status(400).json({ error: bep20Validation.error || 'Invalid USDT BEP-20 address' });
          return;
        }
        normalizedCrypto = bep20Validation.checksumAddress || bep20Validation.normalizedAddress;
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Invalid USDT BEP-20 address' });
        return;
      }
    }

    const updated = await prisma.userPayoutPreference.upsert({
      where: { userId: user.discordId },
      create: {
        userId: user.discordId,
        bankAccountHolder: normalizedBankHolder,
        bankIban: normalizedIban,
        cryptoAddress: normalizedCrypto,
        cryptoNetwork: network,
      },
      update: {
        bankAccountHolder: normalizedBankHolder,
        bankIban: normalizedIban,
        cryptoAddress: normalizedCrypto,
        cryptoNetwork: network,
      },
    });

    // ثبت ممیزی امن بدون افشای شماره شبا یا آدرس کامل در لاگ عمومی
    await prisma.auditLog.create({
      data: {
        actorId: user.discordId,
        action: 'USER_PAYOUT_PREFERENCE_UPDATE',
        entityType: 'UserPayoutPreference',
        entityId: user.discordId,
        newValues: JSON.stringify({
          bankAccountHolder: normalizedBankHolder,
          maskedBankIban: normalizedIban ? maskIban(normalizedIban) : null,
          maskedCryptoAddress: normalizedCrypto ? maskCryptoAddress(normalizedCrypto) : null,
          cryptoNetwork: network,
        }),
      },
    });

    res.json({
      success: true,
      preference: {
        bankAccountHolder: updated.bankAccountHolder,
        bankIban: updated.bankIban,
        maskedBankIban: updated.bankIban ? maskIban(updated.bankIban) : null,
        cryptoAddress: updated.cryptoAddress,
        maskedCryptoAddress: updated.cryptoAddress ? maskCryptoAddress(updated.cryptoAddress) : null,
        cryptoNetwork: updated.cryptoNetwork,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err: any) {
    console.error('[PayoutPreference API] Update error:', err);
    res.status(500).json({ error: 'Failed to update payout preferences' });
  }
};

router.put('/payout-preferences', requireAuth, requireCsrf, handleUpdatePayoutPreferences);
router.put('/api/payout-preferences', requireAuth, requireCsrf, handleUpdatePayoutPreferences);

// ─── صدور پیش‌فاکتور رسمی برداشت (Generate Withdrawal Quote) ───────────────
const handleWithdrawalQuote = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const { payoutMethod, requestedUsdCents, destinationAddress, destinationAccountHolder } = req.body;

    if (!payoutMethod || !requestedUsdCents || !destinationAddress) {
      res.status(400).json({ error: 'payoutMethod, requestedUsdCents, and destinationAddress are required' });
      return;
    }

    const normMethod = String(payoutMethod).toUpperCase().trim();
    let quoteResult;

    if (normMethod === 'USDT' || normMethod === 'USDT_BEP20') {
      quoteResult = await generateUsdtWithdrawalQuote({
        boosterId: user.discordId,
        requestedUsdCents: Number(requestedUsdCents),
        destinationAddress: String(destinationAddress).trim(),
      });
    } else if (normMethod === 'IRT' || normMethod === 'IRT_BANK') {
      quoteResult = await generateIrtWithdrawalQuote({
        boosterId: user.discordId,
        requestedUsdCents: Number(requestedUsdCents),
        destinationAddress: String(destinationAddress).trim(),
        destinationAccountHolder: destinationAccountHolder ? String(destinationAccountHolder).trim() : undefined,
      });
    } else {
      res.status(400).json({ error: "Unsupported payoutMethod. Use 'USDT_BEP20' or 'IRT_BANK'." });
      return;
    }

    const requestRecord = await createWithdrawalRequestFromQuote(quoteResult);
    const serializedQuote = serializeUserWithdrawal(requestRecord);

    res.json({
      success: true,
      quote: {
        ...serializedQuote,
        quoteExpiresAt: requestRecord.quoteExpiresAt,
        quoteHash: requestRecord.quoteHash,
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to generate withdrawal quote' });
  }
};

router.post('/withdrawals/quote', requireAuth, requireCsrf, handleWithdrawalQuote);
router.post('/api/withdrawals/quote', requireAuth, requireCsrf, handleWithdrawalQuote);

// ─── تایید پیش‌فاکتور و قفل موجودی در درخواست تسویه (Confirm Withdrawal) ────
const handleWithdrawalConfirm = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const { requestId } = req.body;

    if (!requestId || typeof requestId !== 'number') {
      res.status(400).json({ error: 'Valid numeric requestId required' });
      return;
    }

    const { request, wallet } = await confirmAndSubmitWithdrawalRequest(requestId, user.discordId);

    // ثبت ممیزی قطعی ایجاد درخواست
    await prisma.auditLog.create({
      data: {
        actorId: user.discordId,
        action: 'WITHDRAWAL_REQUEST_CONFIRMED',
        entityType: 'BoosterWithdrawalRequest',
        entityId: String(request.id),
        newValues: JSON.stringify({
          withdrawalRef: request.withdrawalRef,
          payoutMethod: request.payoutMethod,
          requestedUsdCents: request.requestedUsdCents,
          fixedFeeUsdCents: request.fixedFeeUsdCents,
          netUsdCents: request.netUsdCents,
          quotedNetPayoutAmount: request.quotedNetPayoutAmount,
          quotedCurrency: request.quotedCurrency,
          scheduledCycleDay: request.scheduledCycleDay,
        }),
      },
    });

    res.json({
      success: true,
      request: serializeUserWithdrawal(request),
      wallet: {
        availableCents: wallet.availableCents,
        availableUsd: (wallet.availableCents / 100).toFixed(2),
        reservedCents: wallet.reservedCents,
        reservedUsd: (wallet.reservedCents / 100).toFixed(2),
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to confirm withdrawal' });
  }
};

router.post('/withdrawals/confirm', requireAuth, requireCsrf, handleWithdrawalConfirm);
router.post('/api/withdrawals/confirm', requireAuth, requireCsrf, handleWithdrawalConfirm);

// ─── لغو درخواست تسویه توسط بوستر و استرداد وجوه رزرو (Cancel Withdrawal) ──
const handleWithdrawalCancel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const { requestId, reason } = req.body;

    if (!requestId || typeof requestId !== 'number') {
      res.status(400).json({ error: 'Valid numeric requestId required' });
      return;
    }

    const { request, wallet, alreadyCancelled } = await boosterCancelWithdrawal(
      requestId,
      user.discordId,
      reason ? String(reason).trim() : 'Cancelled by user'
    );

    res.json({
      success: true,
      alreadyCancelled: !!alreadyCancelled,
      request: serializeUserWithdrawal(request),
      wallet: wallet
        ? {
            availableCents: wallet.availableCents,
            availableUsd: (wallet.availableCents / 100).toFixed(2),
            reservedCents: wallet.reservedCents,
            reservedUsd: (wallet.reservedCents / 100).toFixed(2),
          }
        : null,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to cancel withdrawal request' });
  }
};

router.post('/withdrawals/cancel', requireAuth, requireCsrf, handleWithdrawalCancel);
router.post('/api/withdrawals/cancel', requireAuth, requireCsrf, handleWithdrawalCancel);

// ─── تاریخچه درخواست‌های تسویه کاربر جاری (Withdrawal History with Pagination)
const handleWithdrawalHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10)));
    const offset = (page - 1) * limit;

    const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    const methodFilter = req.query.payoutMethod ? String(req.query.payoutMethod).toUpperCase() : undefined;

    const whereClause: any = { boosterId: user.discordId };
    if (statusFilter && statusFilter !== 'ALL') {
      whereClause.status = statusFilter;
    }
    if (methodFilter && methodFilter !== 'ALL') {
      whereClause.payoutMethod = methodFilter;
    }

    const [requestsRaw, total] = await Promise.all([
      prisma.boosterWithdrawalRequest.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.boosterWithdrawalRequest.count({ where: whereClause }),
    ]);

    const withdrawals = requestsRaw.map(serializeUserWithdrawal);

    res.json({
      success: true,
      withdrawals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('[Withdrawal API] History fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve withdrawal history' });
  }
};

router.get('/withdrawals/history', requireAuth, handleWithdrawalHistory);
router.get('/api/withdrawals/history', requireAuth, handleWithdrawalHistory);

// Legacy compat
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
      withdrawals: requests.map(serializeUserWithdrawal),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch withdrawals' });
  }
});
router.get('/api/withdrawals/my', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const requests = await prisma.boosterWithdrawalRequest.findMany({
      where: { boosterId: user.discordId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({
      success: true,
      withdrawals: requests.map(serializeUserWithdrawal),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch withdrawals' });
  }
});

router.get(
  '/admin/withdrawals',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const statusParam = req.query.status ? String(req.query.status).trim().toUpperCase() : '';
      let whereClause: any = {
        status: { in: ['RESERVED', 'UNDER_ADMIN_REVIEW', 'PROCESSING', 'QUOTED'] },
      };
      if (statusParam === 'ALL') {
        whereClause = {};
      } else if (statusParam) {
        const statuses = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
        if (statuses.length > 0) {
          whereClause = { status: { in: statuses } };
        }
      }

      const requests = await prisma.boosterWithdrawalRequest.findMany({
        where: whereClause,
        include: {
          booster: {
            select: { discordId: true, username: true, displayName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        withdrawals: requests.map(serializeAdminWithdrawal),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  '/admin/withdrawals/:id/review',
  requireAuth,
  requireRole('owner', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const auth = await authorize(user.discordId, Permission.WITHDRAWAL_REVIEW);
      if (!auth.allowed) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Withdrawal review requires Admin or Owner permission' });
        return;
      }

      const id = Number(req.params.id);
      const { decision, txHash, bankReceiptRef, reason, secondReviewerId } = req.body;

      if (decision === 'approve_processing') {
        const { request: processingReq } = await adminApproveWithdrawalForProcessing(
          id,
          user.discordId,
          req.body.notes || reason
        );
        res.json({
          success: true,
          request: serializeAdminWithdrawal(processingReq),
        });
      } else if (decision === 'approve_paid') {
        const tx = txHash ? String(txHash).trim() : '';
        const receipt = bankReceiptRef ? String(bankReceiptRef).trim() : tx;
        if (!tx && !receipt) {
          res.status(400).json({
            error:
              'Verified blockchain TxHash or Bank Receipt reference is strictly required for manual payout disbursement',
          });
          return;
        }
        // ساختارهای مدارک ارسالی کلاینت نادیده گرفته شده و استعلام صرفاً توسط سرور انجام می‌شود
        const { request: updatedReq } = await adminExecuteManualPayout(id, user.discordId, {
          externalTxHash: tx || undefined,
          bankReceiptRef: receipt || undefined,
          secondReviewerId: secondReviewerId ? String(secondReviewerId).trim() : undefined,
          notes: req.body.notes || 'Executed via Admin Hub with verified disbursement evidence',
        });
        res.json({
          success: true,
          request: serializeAdminWithdrawal(updatedReq),
        });
      } else if (decision === 'reject') {
        const rejReason = reason || 'Rejected by administration';
        const { request } = await adminRejectWithdrawal(id, user.discordId, rejReason);
        res.json({
          success: true,
          request: serializeAdminWithdrawal(request),
        });
      } else {
        res.status(400).json({ error: "Invalid decision. Must be 'approve_processing', 'approve_paid', or 'reject'." });
      }
    } catch (err: any) {
      const msg = err.message || 'Withdrawal review failed';
      const status = msg.includes('LIVE_PAYOUTS_DISABLED') || msg.includes('UNAUTHORIZED') ? 403 : 400;
      res.status(status).json({ error: msg });
    }
  }
);

// ویرایش متادیتای درخواست برداشت توسط ادمین یا مالک (با ثبت سوابق قبلی و جدید در ممیزی)
const handleWithdrawalMetadataEdit = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const id = Number(req.params.id);
    const { notes, adminNotes, reason } = req.body;

    const result = await updateWithdrawalMetadata({
      requestId: id,
      actorId: user.discordId,
      notes,
      adminNotes,
      reason,
    });

    res.json({
      success: true,
      request: serializeAdminWithdrawal(result.request),
      changedFields: result.changedFields,
      previousValues: result.previousValues,
      newValues: result.newValues,
      reason: result.reason,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update withdrawal metadata' });
  }
};

router.patch(
  '/admin/withdrawals/:id/metadata',
  requireAuth,
  requireRole('owner', 'admin'),
  requireCsrf,
  handleWithdrawalMetadataEdit
);

router.post(
  '/admin/withdrawals/:id/metadata',
  requireAuth,
  requireRole('owner', 'admin'),
  requireCsrf,
  handleWithdrawalMetadataEdit
);

// تاریخچه ممیزی یک درخواست برداشت
router.get(
  '/admin/withdrawals/:id/audit-history',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Number(req.params.id);
      const logs = await getWithdrawalAuditHistory(id);
      const history = logs.map((l) => {
        let parsedDetails: any = null;
        if (l.newValues) {
          try {
            parsedDetails = JSON.parse(l.newValues);
          } catch {
            parsedDetails = l.newValues;
          }
        }
        return {
          id: l.id,
          action: l.action,
          reason: l.reason,
          createdAt: l.createdAt,
          details: parsedDetails,
          actor: l.actor
            ? {
                id: l.actor.discordId,
                username: l.actor.username,
                displayName: l.actor.displayName,
              }
            : null,
        };
      });
      res.json({ success: true, logs, history });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch withdrawal audit history' });
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
      const {
        gameSlug,
        serviceId,
        grossAmountUsd,
        orderType,
        notes,
        sourcePlatform,
        platformAccountRef,
        platformAccountId,
        sourceAmountType,
        listingCategory,
      } = req.body;

      if (!gameSlug || !serviceId || !grossAmountUsd) {
        res.status(400).json({ error: 'gameSlug, serviceId, and grossAmountUsd are required' });
        return;
      }

      const grossCents = Math.round(Number(grossAmountUsd) * 100);
      if (!Number.isSafeInteger(grossCents) || grossCents <= 0) {
        res.status(400).json({ error: 'Amount must be a positive integer in cents' });
        return;
      }

      // If an external platform source is specified, route to platformOrderService
      if (sourcePlatform) {
        const extResult = await createExternalOrder({
          gameSlug,
          serviceId: Number(serviceId),
          amountMinor: grossCents,
          sourcePlatform,
          platformAccountRef,
          platformAccountId: platformAccountId ? Number(platformAccountId) : undefined,
          sourceAmountType: sourceAmountType === 'platform_net' ? 'platform_net' : 'gross_sale',
          orderType,
          listingCategory,
          notes,
          actorId: user.discordId,
        });

        res.json({
          success: true,
          order: {
            ...extResult.order,
            simplifiedStatus: mapOrderStatus(extResult.order.status),
          },
          snapshot: extResult.snapshot,
          platformAccount: extResult.platformAccount,
        });
        return;
      }

      // Direct Boost Order flow using authoritative, transaction-safe WalletV2 atomic funding
      const runsCount = Math.max(1, parseInt(String(req.body.runsCount || 1), 10) || 1);
      const orderMode = req.body.orderMode === 'pilot' ? 'pilot' : 'non_pilot';

      const createResult = await createAdvertiserBoostOrder({
        actorId: user.discordId,
        gameSlug,
        serviceId: Number(serviceId),
        grossAmountMinor: grossCents,
        orderMode,
        runsCount,
        keyLevel: req.body.keyLevel,
        dungeonName: req.body.dungeonName,
        requiredBoosterCount: req.body.requiredBoosterCount ? Number(req.body.requiredBoosterCount) : undefined,
        requiredRoles: req.body.requiredRoles,
        vpnLocation: req.body.vpnLocation,
        customerInfo: req.body.customerInfo,
        notes: req.body.notes,
        idempotencyKey: req.body.idempotencyKey,
        actionSource: 'web_portal',
      });

      res.json({
        success: true,
        order: {
          ...createResult.order,
          simplifiedStatus: mapOrderStatus(createResult.order.status),
        },
        snapshot: createResult.snapshot,
        isFunded: createResult.isFunded,
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
      const result = await payOrderFromWallet(orderId, user.discordId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to pay for order' });
    }
  }
);

router.get(
  '/orders/:id/funding-status',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orderId = Number(req.params.id);
      const diagnostics = await getOrderDiagnostics(orderId);
      res.json({ success: true, diagnostics });
    } catch (err: any) {
      res.status(404).json({ error: err.message || 'Order not found' });
    }
  }
);

router.post(
  '/orders/:id/publish',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      const discordClient = getGlobalDiscordClient();
      const result = await publishOrder(orderId, user.discordId, discordClient);
      res.json({ message: 'Order published to Discord Orders Board', ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to publish order' });
    }
  }
);

router.post(
  '/orders/:id/cancel',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      const { reason = 'Cancelled via web portal' } = req.body;
      const discordClient = getGlobalDiscordClient();
      const result = await cancelOrderWithLifecycle(orderId, user.discordId, reason, discordClient);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to cancel order' });
    }
  }
);

router.post(
  '/orders/:id/claim',
  requireAuth,
  requireCsrf,
  async (_req: Request, res: Response): Promise<void> => {
    // RULE A: Boost claims and pre-signing are strictly Discord-only. Web self-claim bypass is permanently closed.
    res.status(403).json({
      error: 'DISCORD_CLAIM_ONLY',
      message: 'Order claims and pre-signing must be performed exclusively through authorized Discord bot interactions.',
    });
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

router.post(
  '/orders/:id/release-earnings',
  requireAuth,
  requireRole('owner', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      if (isNaN(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const releaseRes = await executeG4XBoostRelease(orderId, user.discordId);
      if (releaseRes.blockedByConfig || !('tracker' in releaseRes)) {
        res.status(403).json({
          success: false,
          blockedByConfig: true,
          gate: 'ESCROW_RELEASE_ENABLED',
          stage: releaseRes.stage,
          error: 'ESCROW_RELEASE_DISABLED',
          message: 'message' in releaseRes ? releaseRes.message : 'ESCROW_RELEASE_ENABLED is disabled.',
        });
        return;
      }

      res.json({
        success: true,
        stage: releaseRes.stage,
        tracker: releaseRes.tracker,
      });
    } catch (err: any) {
      const msg = err.message || 'Release execution failed';
      const status = msg.startsWith('UNAUTHORIZED') ? 403 : 400;
      res.status(status).json({ error: msg });
    }
  }
);

router.get(
  '/admin/orders',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const view = req.query.view ? String(req.query.view) : undefined;
      const gameSlug = req.query.gameSlug ? String(req.query.gameSlug) : undefined;

      if (view === 'dashboard' || view === 'categorized') {
        const categorized = await getCategorizedOrders({ gameSlug });
        res.json({ success: true, ...categorized });
        return;
      }

      const categorized = await getCategorizedOrders({ gameSlug });
      const orders = await prisma.order.findMany({
        where: gameSlug ? { gameSlug } : {},
        include: {
          service: true,
          runs: true,
          boostReleaseTracker: true,
          platformAccount: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      res.json({
        success: true,
        counts: categorized.counts,
        orders: orders.map((o) => ({
          id: o.id,
          orderRef: o.orderRef,
          gameSlug: o.gameSlug,
          serviceName: o.service.displayName,
          grossAmountUsd: (o.grossAmountMinor / 100).toFixed(2),
          boosterPoolUsd: (o.boosterPoolMinor / 100).toFixed(2),
          status: o.status,
          paymentStatus: o.paymentStatus,
          creatorType: o.creatorType,
          sourceType: o.sourceType,
          sourceWebsite: o.sourceWebsite,
          platformAccount: o.platformAccount?.displayName || null,
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

router.get(
  '/admin/orders/dashboard',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const gameSlug = req.query.gameSlug ? String(req.query.gameSlug) : undefined;
      const result = await getCategorizedOrders({ gameSlug });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch categorized orders' });
    }
  }
);

/**
 * Authoritative Separated Orders List (G4X vs. Advertiser)
 * Supports server-side pagination, search, status/game/source/date filtering,
 * and strict privacy enforcement for advertisers.
 */
async function handleSeparatedOrdersList(req: Request, res: Response): Promise<void> {
  try {
    const { user } = req as AuthenticatedRequest;
    const tab = req.query.tab ? String(req.query.tab) : (req.query.origin ? String(req.query.origin) : 'g4x');
    const result = await getSeparatedOrdersList({
      tab: tab === 'advertiser' ? 'advertiser' : 'g4x',
      origin: tab as any,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      paymentStatus: req.query.paymentStatus ? String(req.query.paymentStatus) : undefined,
      gameSlug: req.query.gameSlug ? String(req.query.gameSlug) : undefined,
      source: req.query.source ? String(req.query.source) : undefined,
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      user: {
        discordId: user.discordId,
        userRoles: user.userRoles || [],
      },
    });

    res.json(result);
  } catch (err: any) {
    if (err instanceof DomainError) {
      if (err.code === DomainErrorCode.PERMISSION_DENIED) {
        res.status(403).json({ error: err.message, code: err.code });
        return;
      }
      if (err.code === DomainErrorCode.ORDER_NOT_FOUND) {
        res.status(404).json({ error: err.message, code: err.code });
        return;
      }
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: err.message || 'Failed to fetch separated orders list' });
  }
}

router.get('/orders/dashboard-list', requireAuth, handleSeparatedOrdersList);
router.get('/admin/orders/dashboard-list', requireAuth, handleSeparatedOrdersList);

router.get(
  '/admin/orders/:id',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orderId = Number(req.params.id);
      const diagnostics = await getOrderDiagnostics(orderId);
      res.json({ success: true, order: diagnostics });
    } catch (err: any) {
      res.status(404).json({ error: err.message || 'Order not found' });
    }
  }
);

router.get(
  '/admin/orders/:id/audit-history',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orderId = Number(req.params.id);
      const auditLogs = await getOrderAuditHistory(orderId);
      res.json({ success: true, auditLogs });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch audit history' });
    }
  }
);

router.post(
  '/admin/orders/:id/publish',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      const discordClient = getGlobalDiscordClient();
      const result = await publishOrder(orderId, user.discordId, discordClient);
      res.json({ message: 'Order published to Discord Orders Board', ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to publish order' });
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

// ═════════════════════════════════════════════════════════════════════════════
// ─── JOURNEY F.2: پورتال ادورتایزر (Advertiser Portal Overview & Management)
// ═════════════════════════════════════════════════════════════════════════════

// ۱. دریافت اطلاعات کلی پورتال، رنک و عملکردهای مالی ادورتایزر
router.get(
  '/advertiser/portal-overview',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const dbUser = await prisma.user.findUnique({
        where: { discordId: user.discordId },
        include: {
          userRoles: true,
          walletV2: true,
        },
      });

      if (!dbUser) {
        res.status(404).json({ error: 'User profile not found' });
        return;
      }

      const roles = (dbUser.userRoles || []).map((r) => r.roleKey.toLowerCase());
      const isAdvertiser = roles.includes('advertiser');
      const isStaffOrAdmin = roles.some((r) => ['owner', 'manager', 'admin'].includes(r));

      // بررسی درخواست ثبت‌نام در صورت تایید نشدن
      const latestApp = await prisma.registrationApplication.findFirst({
        where: { userId: user.discordId, category: 'advertiser' },
        orderBy: { submittedAt: 'desc' },
      });

      // رنک تجاری ادورتایزر
      const rank = await getAdvertiserRank(user.discordId);
      const basisPoints = rank ? getRankBasisPoints(rank) : (isAdvertiser ? 1499 : null);
      const commissionPercent = basisPoints !== null ? formatBasisPoints(basisPoints) : null;
      const rankLabel = rank ? ADVERTISER_RANK_LABELS[rank] : (isAdvertiser ? 'Bronze (14.99%)' : 'Unassigned');

      // لیست کامل سلسله‌مراتب رنک‌ها طبق مستندات و سیاست مصوب G4X
      const rankHierarchy = [
        {
          rank: AdvertiserRank.BRONZE,
          label: 'Bronze',
          basisPoints: 1499,
          percentage: '14.99%',
          description: 'Standard tier for newly registered advertisers',
          isCurrent: rank === AdvertiserRank.BRONZE || (!rank && isAdvertiser),
        },
        {
          rank: AdvertiserRank.SILVER,
          label: 'Silver',
          basisPoints: 1299,
          percentage: '12.99%',
          description: 'Established commercial boosting volume',
          isCurrent: rank === AdvertiserRank.SILVER,
        },
        {
          rank: AdvertiserRank.GOLD,
          label: 'Gold',
          basisPoints: 1099,
          percentage: '10.99%',
          description: 'High-volume commercial agencies and syndicates',
          isCurrent: rank === AdvertiserRank.GOLD,
        },
        {
          rank: AdvertiserRank.DIAMOND,
          label: 'Diamond',
          basisPoints: 899,
          percentage: '8.99%',
          description: 'Enterprise commercial volume tier',
          isCurrent: rank === AdvertiserRank.DIAMOND,
        },
        {
          rank: AdvertiserRank.FOUNDING_ADVERTISER,
          label: 'Founding Advertiser',
          basisPoints: 899,
          percentage: '8.99%',
          description: 'Dedicated partner tier for founding community members',
          isCurrent: rank === AdvertiserRank.FOUNDING_ADVERTISER,
        },
        {
          rank: AdvertiserRank.OFFICIAL_PARTNERS,
          label: 'Official Partners',
          basisPoints: 699,
          percentage: '6.99%',
          description: 'Exclusive premier platform syndicates',
          isCurrent: rank === AdvertiserRank.OFFICIAL_PARTNERS,
        },
      ];

      // والت و موجودی‌های مالی
      const walletV2 = dbUser.walletV2;
      const availableCents = walletV2?.availableCents ?? 0;
      const reservedCents = walletV2?.reservedCents ?? 0;
      const pendingEarningsCents = walletV2?.pendingEarningsCents ?? 0;
      const paidCents = walletV2?.paidCents ?? 0;

      // آمار و شمارنده‌های واقعی سفارشات ادورتایزر
      const activeStatuses = ['draft', 'payment_pending', 'open_presign', 'presign_closed', 'assigned', 'in_progress', 'disputed'];
      const ownershipWhere = isStaffOrAdmin && !isAdvertiser
        ? { sourceWebsite: null, OR: [{ creatorType: 'advertiser' }, { advertiserId: { not: null } }] }
        : { sourceWebsite: null, OR: [{ advertiserId: user.discordId }, { creatorId: user.discordId, creatorType: 'advertiser' }] };

      const [totalCreated, activeCount, completedCount, cancelledCount, volumeAgg] = await Promise.all([
        prisma.order.count({ where: ownershipWhere }),
        prisma.order.count({ where: { AND: [ownershipWhere, { status: { in: activeStatuses } }] } }),
        prisma.order.count({ where: { AND: [ownershipWhere, { status: 'completed' }] } }),
        prisma.order.count({ where: { AND: [ownershipWhere, { status: 'cancelled' }] } }),
        prisma.order.aggregate({
          where: { AND: [ownershipWhere, { status: 'completed' }] },
          _sum: { grossAmountMinor: true, platformFeeMinor: true },
        }),
      ]);

      const totalGrossCompletedCents = volumeAgg._sum.grossAmountMinor || 0;
      const totalFeePaidCents = volumeAgg._sum.platformFeeMinor || 0;

      // لینک‌های موثق دیسکورد
      const discordGuildId = process.env.DISCORD_GUILD_ID || null;
      const ordersChannelId = process.env.CHANNEL_ORDERS || null;
      const becomeAdvChannelId = process.env.CHANNEL_BECOME_ADVERTISER || null;
      const orderEntryUrl = discordGuildId && ordersChannelId
        ? `https://discord.com/channels/${discordGuildId}/${ordersChannelId}`
        : null;

      res.json({
        success: true,
        profile: {
          discordId: dbUser.discordId,
          username: dbUser.username,
          displayName: dbUser.displayName || dbUser.username,
          roles,
          isApprovedAdvertiser: isAdvertiser || isStaffOrAdmin,
          isStaffOversight: isStaffOrAdmin && !isAdvertiser,
          advertiserRank: rank || (isAdvertiser ? AdvertiserRank.BRONZE : null),
          rankLabel,
          applicationStatus: latestApp?.status || (isAdvertiser ? 'approved' : 'none'),
          applicationDate: latestApp?.submittedAt || null,
        },
        rank: {
          currentRank: rank || (isAdvertiser ? AdvertiserRank.BRONZE : null),
          rankLabel,
          basisPoints: basisPoints || 1499,
          commissionPercent: commissionPercent || '14.99%',
          rankHierarchy,
        },
        wallet: {
          availableCents,
          availableUsd: (availableCents / 100).toFixed(2),
          reservedCents,
          reservedUsd: (reservedCents / 100).toFixed(2),
          pendingEarningsCents,
          pendingEarningsUsd: (pendingEarningsCents / 100).toFixed(2),
          paidCents,
          paidUsd: (paidCents / 100).toFixed(2),
          canPlaceOrders: availableCents > 0,
        },
        performance: {
          totalOrdersCreated: totalCreated,
          activeOrdersCount: activeCount,
          completedOrdersCount: completedCount,
          cancelledOrdersCount: cancelledCount,
          totalGrossVolumeUsd: (totalGrossCompletedCents / 100).toFixed(2),
          totalPlatformFeesPaidUsd: (totalFeePaidCents / 100).toFixed(2),
        },
        discordIntegration: {
          guildId: discordGuildId,
          ordersChannelId,
          becomeAdvChannelId,
          orderEntryUrl,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch advertiser overview' });
    }
  }
);

// ۲. ویرایش محدود یادداشت سفارش توسط ادورتایزر صاحب سفارش
router.patch(
  '/advertiser/orders/:id/notes',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      if (isNaN(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const { notes } = req.body;
      const trimmedNotes = notes !== undefined && notes !== null ? String(notes).trim() : '';

      if (trimmedNotes.length > 500) {
        res.status(400).json({ error: 'Order notes cannot exceed 500 characters' });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        res.status(404).json({ error: `Order #${orderId} not found` });
        return;
      }

      const origin = classifyOrderOrigin(order);
      if (origin !== 'advertiser') {
        res.status(403).json({
          error: 'NON_ADVERTISER_ORDER: Only Advertiser-originated orders can be managed via the Advertiser Portal',
        });
        return;
      }

      const auth = await authorize(user.discordId, Permission.ORDER_VIEW_PRIVATE, {
        orderId,
        order,
      });

      if (!auth.allowed) {
        res.status(403).json({
          error: `PERMISSION_DENIED: ${auth.reason || 'You are not authorized to edit notes on this order'}`,
        });
        return;
      }

      if (['completed', 'cancelled'].includes(order.status)) {
        res.status(400).json({ error: 'ORDER_IMMUTABLE: Notes cannot be edited on completed or cancelled orders' });
        return;
      }

      const previousNotes = order.notes;
      const updated = await prisma.order.update({
        where: { id: orderId },
        data: { notes: trimmedNotes || null },
      });

      await prisma.auditLog.create({
        data: {
          actorId: user.discordId,
          action: 'ORDER_NOTES_UPDATED',
          entityType: 'Order',
          entityId: String(orderId),
          previousValues: JSON.stringify({ notes: previousNotes }),
          newValues: JSON.stringify({ notes: updated.notes }),
          reason: 'Advertiser updated order notes via Advertiser Portal',
          isSuccess: true,
        },
      });

      res.json({
        success: true,
        orderId: updated.id,
        notes: updated.notes,
        message: 'Order notes updated successfully',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update order notes' });
    }
  }
);

// ۳. ثبت درخواست لغو سفارش توسط ادورتایزر
router.post(
  '/advertiser/orders/:id/cancel-request',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      if (isNaN(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const { reason = 'Cancelled by advertiser' } = req.body;
      const trimmedReason = String(reason).trim();
      if (trimmedReason.length < 5) {
        res.status(400).json({ error: 'A cancellation reason (minimum 5 characters) is required' });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          assignments: { where: { status: 'assigned' } },
          disputes: { where: { status: { in: ['open', 'under_review'] } } },
        },
      });

      if (!order) {
        res.status(404).json({ error: `Order #${orderId} not found` });
        return;
      }

      const origin = classifyOrderOrigin(order);
      if (origin !== 'advertiser') {
        res.status(403).json({
          error: 'NON_ADVERTISER_ORDER: Only Advertiser-originated orders can be managed via the Advertiser Portal',
        });
        return;
      }

      const auth = await authorize(user.discordId, Permission.ORDER_CANCEL, {
        orderId,
        order,
      });

      if (!auth.allowed) {
        res.status(403).json({
          error: `PERMISSION_DENIED: ${auth.reason || 'You are not authorized to cancel this order'}`,
        });
        return;
      }

      if (order.status === 'cancelled') {
        res.status(400).json({ error: 'ALREADY_CANCELLED: Order is already cancelled' });
        return;
      }

      if (order.status === 'completed') {
        res.status(400).json({ error: 'ORDER_COMPLETED: Completed orders cannot be cancelled' });
        return;
      }

      // ۱. اگر سفارش هنوز تعهد مالی فعال یا بوستر منتسب ندارد (مانند draft, payment_pending یا open_presign بدون انتساب)
      if (['draft', 'payment_pending', 'open_presign'].includes(order.status) && order.assignments.length === 0) {
        const discordClient = getGlobalDiscordClient();
        const cancelResult = await cancelOrderWithLifecycle(orderId, user.discordId, trimmedReason, discordClient);
        res.json({
          success: true,
          status: 'cancelled',
          message: 'Order cancelled immediately as no boosters were assigned and work has not commenced.',
          order: cancelResult.order,
        });
        return;
      }

      // ۲. در صورتی که سفارش دارای بوسترهای منتسب، در حال اجرا، یا تعهد مالی فعال باشد
      // ادورتایزر نمی‌تواند تعهدات مالی فعال را راساً لغو کند و درخواست باید از طریق چرخه بازبینی مدیریت عبور کند
      if (order.disputes && order.disputes.length > 0) {
        res.status(400).json({
          error: `DUPLICATE_CANCELLATION_REQUEST: A review request or dispute (#${order.disputes[0].id}) is already open for this order.`,
        });
        return;
      }

      const discordClient = getGlobalDiscordClient();
      const disputeResult = await openOrderDispute({
        orderId,
        actorId: user.discordId,
        disputeType: 'other',
        description: `Advertiser Cancellation Request: ${trimmedReason}`,
        discordClient,
      });

      res.json({
        success: true,
        status: 'pending_review',
        disputeId: disputeResult.dispute.id,
        message: 'Cancellation request submitted for management review. Because active boosters or financial commitments exist, staff will review and settle the order.',
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to submit cancellation request' });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// ─── JOURNEY G: اختلافات سفارش و شواهد اتمام ران (Disputes & Proof Review)
// ═════════════════════════════════════════════════════════════════════════════

// ۱. دریافت لیست اختلافات (کاربران عادی فقط اختلافات مرتبط، پرسنل همه را مشاهده می‌کنند)
router.get(
  '/disputes',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const userRoles = (user.userRoles?.map((r) => r.roleKey) || []).map((r) => r.toLowerCase());
      const isStaffOrAdmin = userRoles.some((r) => ['owner', 'manager', 'admin', 'staff'].includes(r));
      const statusFilter = req.query.status as string | undefined;

      const disputes = await getDisputesForUser(user.discordId, isStaffOrAdmin, { status: statusFilter });
      res.json({ success: true, disputes });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch disputes' });
    }
  }
);

// ۲. دریافت اختلافات یک سفارش مشخص
router.get(
  '/orders/:id/disputes',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      if (isNaN(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { assignments: { where: { status: 'assigned' } } },
      });

      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      const userRoles = (user.userRoles?.map((r) => r.roleKey) || []).map((r) => r.toLowerCase());
      const isStaffOrAdmin = userRoles.some((r) => ['owner', 'manager', 'admin', 'staff'].includes(r));
      const isParticipant =
        order.customerId === user.discordId ||
        order.advertiserId === user.discordId ||
        order.creatorId === user.discordId ||
        order.assignments.some((a) => a.userId === user.discordId);

      if (!isStaffOrAdmin && !isParticipant) {
        res.status(403).json({ error: 'PERMISSION_DENIED: Cannot view disputes for this order' });
        return;
      }

      const disputes = await prisma.orderDispute.findMany({
        where: { orderId },
        include: {
          openedBy: { select: { discordId: true, username: true } },
          assignedReviewer: { select: { discordId: true, username: true } },
          resolver: { select: { discordId: true, username: true } },
          escrowHolds: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        disputes: disputes.map((d) => ({
          ...d,
          simplifiedStatus: formatDisputeStatusLabel(d.status),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch order disputes' });
    }
  }
);

// ۳. باز کردن شکایت / اختلاف روی یک سفارش
router.post(
  '/orders/:id/disputes',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      if (isNaN(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const { disputeType, description, evidenceUrl, runId } = req.body;
      const discordClient = req.app.get('discordClient');

      const result = await openOrderDispute({
        orderId,
        actorId: user.discordId,
        disputeType: disputeType || 'other',
        description,
        evidenceUrl,
        runId: runId ? Number(runId) : undefined,
        discordClient,
      });

      res.status(201).json({
        success: true,
        dispute: {
          ...result.dispute,
          simplifiedStatus: formatDisputeStatusLabel(result.dispute.status),
        },
        holdId: result.hold.id,
      });
    } catch (err: any) {
      const status = err.name === 'DomainError' ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to open dispute', code: err.code });
    }
  }
);

// ۴. ارسال مدارک تکمیلی برای یک اختلاف موجود
router.post(
  '/disputes/:id/evidence',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const disputeId = Number(req.params.id);
      if (isNaN(disputeId) || disputeId <= 0) {
        res.status(400).json({ error: 'Invalid dispute ID' });
        return;
      }

      const { evidenceUrl, description } = req.body;
      const discordClient = req.app.get('discordClient');

      const updated = await submitDisputeEvidence({
        disputeId,
        actorId: user.discordId,
        evidenceUrl,
        description,
        discordClient,
      });

      res.json({
        success: true,
        dispute: {
          ...updated,
          simplifiedStatus: formatDisputeStatusLabel(updated.status),
        },
      });
    } catch (err: any) {
      const status = err.name === 'DomainError' ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to submit evidence', code: err.code });
    }
  }
);

// ۵. درخواست مدارک بیشتر توسط استف / ادمین
router.post(
  '/admin/disputes/:id/request-evidence',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const disputeId = Number(req.params.id);
      if (isNaN(disputeId) || disputeId <= 0) {
        res.status(400).json({ error: 'Invalid dispute ID' });
        return;
      }

      const { requestNotes } = req.body;
      const discordClient = req.app.get('discordClient');

      const updated = await requestDisputeEvidence({
        disputeId,
        staffId: user.discordId,
        requestNotes,
        discordClient,
      });

      res.json({
        success: true,
        dispute: {
          ...updated,
          simplifiedStatus: formatDisputeStatusLabel(updated.status),
        },
      });
    } catch (err: any) {
      const status = err.name === 'DomainError' ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to request evidence', code: err.code });
    }
  }
);

// ۶. ثبت یادداشت بازبینی داخلی روی اختلاف
router.post(
  '/admin/disputes/:id/notes',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const disputeId = Number(req.params.id);
      if (isNaN(disputeId) || disputeId <= 0) {
        res.status(400).json({ error: 'Invalid dispute ID' });
        return;
      }

      const { notes } = req.body;
      const updated = await addDisputeReviewNotes({
        disputeId,
        staffId: user.discordId,
        notes,
      });

      res.json({
        success: true,
        dispute: {
          ...updated,
          simplifiedStatus: formatDisputeStatusLabel(updated.status),
        },
      });
    } catch (err: any) {
      const status = err.name === 'DomainError' ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to add review notes', code: err.code });
    }
  }
);

// ۷. صدور رای نهایی و حل اختلاف (فقط ادمین یا اونر)
router.post(
  '/admin/disputes/:id/resolve',
  requireAuth,
  requireRole('owner', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const disputeId = Number(req.params.id);
      if (isNaN(disputeId) || disputeId <= 0) {
        res.status(400).json({ error: 'Invalid dispute ID' });
        return;
      }

      const { decision, resolutionNotes } = req.body;
      const discordClient = req.app.get('discordClient');

      const resolved = await resolveOrderDispute({
        disputeId,
        resolverId: user.discordId,
        decision: decision || 'resolved',
        resolutionNotes,
        discordClient,
      });

      res.json({
        success: true,
        dispute: {
          ...resolved,
          simplifiedStatus: formatDisputeStatusLabel(resolved.status),
        },
      });
    } catch (err: any) {
      const status = err.name === 'DomainError' ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to resolve dispute', code: err.code });
    }
  }
);

// ۸. دریافت مدارک ران‌های یک سفارش
router.get(
  '/orders/:id/proofs',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      if (isNaN(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          assignments: { where: { status: 'assigned' } },
          runs: {
            include: {
              proofs: {
                include: {
                  submittedBy: { select: { discordId: true, username: true } },
                  reviewedBy: { select: { discordId: true, username: true } },
                },
              },
            },
          },
        },
      });

      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      const userRoles = (user.userRoles?.map((r) => r.roleKey) || []).map((r) => r.toLowerCase());
      const isStaffOrAdmin = userRoles.some((r) => ['owner', 'manager', 'admin', 'staff'].includes(r));
      const isParticipant =
        order.customerId === user.discordId ||
        order.advertiserId === user.discordId ||
        order.creatorId === user.discordId ||
        order.assignments.some((a) => a.userId === user.discordId);

      if (!isStaffOrAdmin && !isParticipant) {
        res.status(403).json({ error: 'PERMISSION_DENIED: Cannot view proofs for this order' });
        return;
      }

      const proofs = order.runs.flatMap((r) =>
        r.proofs.map((p) => ({ ...p, runNumber: r.runNumber, orderId: order.id }))
      );

      res.json({ success: true, proofs });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch order proofs' });
    }
  }
);

// ۹. ارسال مدرک اتمام برای یک ران
router.post(
  '/orders/:id/proofs',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      if (isNaN(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const { runId, proofType, evidenceUrl, description } = req.body;
      const discordClient = req.app.get('discordClient');

      const proof = await submitRunProof({
        runId: Number(runId),
        submittedById: user.discordId,
        proofType,
        evidenceUrl,
        description,
        discordClient,
      });

      res.status(201).json({ success: true, proof });
    } catch (err: any) {
      const status = err.name === 'DomainError' ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to submit proof', code: err.code });
    }
  }
);

// ۱۰. بازبینی و تایید یا رد مدرک ران توسط استف یا ادمین
router.post(
  '/admin/proofs/:id/review',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const proofId = Number(req.params.id);
      if (isNaN(proofId) || proofId <= 0) {
        res.status(400).json({ error: 'Invalid proof ID' });
        return;
      }

      const { decision, reviewNotes } = req.body;
      const discordClient = req.app.get('discordClient');

      const reviewed = await reviewRunProof({
        proofId,
        reviewerId: user.discordId,
        decision: decision === 'reject' ? 'reject' : 'approve',
        reviewNotes,
        discordClient,
      });

      res.json({ success: true, proof: reviewed });
    } catch (err: any) {
      const status = err.name === 'DomainError' ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to review proof', code: err.code });
    }
  }
);

// ۱۱. دریافت تاریخچه حسابرسی اختلاف (Dispute Audit History)
router.get(
  '/admin/disputes/:id/audit-history',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const disputeId = Number(req.params.id);
      if (isNaN(disputeId) || disputeId <= 0) {
        res.status(400).json({ error: 'Invalid dispute ID' });
        return;
      }

      const logs = await prisma.auditLog.findMany({
        where: {
          OR: [
            { entityType: 'OrderDispute', entityId: String(disputeId) },
            { action: { in: ['ORDER_DISPUTE_OPENED', 'ORDER_DISPUTE_RESOLVED', 'DISPUTE_EVIDENCE_REQUESTED', 'DISPUTE_EVIDENCE_SUBMITTED', 'DISPUTE_REVIEW_NOTE_ADDED'] } },
          ],
        },
        include: { actor: { select: { discordId: true, username: true } } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });

      res.json({ success: true, history: logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch dispute audit history' });
    }
  }
);
// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM FINANCE — G2G, SKYCOACH & ELDORADO ADMIN DASHBOARD & RECONCILIATION
// ─────────────────────────────────────────────────────────────────────────────

// ۱. دریافت خلاصه مقایسه‌ای سه پلتفرم (Platform Finance Overview)
router.get(
  '/admin/platform-finance/overview',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const auth = await authorize(user.discordId, Permission.FINANCE_ADMIN_VIEW);
      if (!auth.allowed) {
        res.status(403).json({ error: auth.reason || 'Insufficient permissions to view platform finance data' });
        return;
      }

      // اطمینان از وجود حساب‌های پیش‌فرض سه پلتفرم
      await getOrCreatePlatformAccount('g2g_main', 'g2g', 'G2G (Main Store)');
      await getOrCreatePlatformAccount('skycoach_main', 'skycoach', 'SkyCoach (Main)');
      await getOrCreatePlatformAccount('eldorado_main', 'eldorado', 'Eldorado (Main Store)');

      const accounts = await getPlatformAccountsSummary(user.discordId);

      // آمار دسته‌های برداشت در جریان و تسویه‌شده
      const batches = await prisma.platformWithdrawalBatch.findMany({
        select: {
          id: true,
          platform: true,
          status: true,
          totalContributionsMinor: true,
          netReceivedMinor: true,
          actualReceivedMinor: true,
        },
      });

      // سفارشات تسویه‌شده پلتفرم‌های خارجی
      const settledExternalOrders = await prisma.order.findMany({
        where: {
          sourceWebsite: { in: ['g2g', 'skycoach', 'eldorado'] },
          status: { in: ['completed', 'assigned', 'in_progress'] },
          paymentStatus: { in: ['verified', 'unneeded'] },
          financialSnapshot: { isNot: null },
        },
        include: {
          financialSnapshot: true,
          withdrawalAllocations: {
            include: { batch: true },
          },
        },
      });

      // تجمیع اطلاعات پلتفرم‌ها
      const platformSummaries = accounts.map((acc) => {
        const platformBatches = batches.filter((b) => b.platform.toLowerCase() === acc.platform.toLowerCase());
        const pendingBatches = platformBatches.filter((b) =>
          ['draft', 'ready', 'submitted', 'processing', 'received', 'review_required'].includes(b.status)
        );
        const reconciledBatches = platformBatches.filter((b) => b.status === 'reconciled');

        const pendingBatchesAmountMinor = pendingBatches.reduce((s, b) => s + b.totalContributionsMinor, 0);
        const reconciledTotalReceivedMinor = reconciledBatches.reduce((s, b) => s + (b.actualReceivedMinor ?? b.netReceivedMinor), 0);

        // سفارشات مرتبط با این پلتفرم
        const ordersForPlatform = settledExternalOrders.filter(
          (o) => (o.sourceWebsite || '').toLowerCase() === acc.platform.toLowerCase()
        );

        let grossRevenueMinor = 0;
        let platformFeesChargedMinor = 0;
        let eligibleForBatchMinor = 0;
        let pendingReconciliationMinor = 0;

        for (const ord of ordersForPlatform) {
          const snap = ord.financialSnapshot;
          if (snap) {
            grossRevenueMinor += (snap.grossSaleMinor ?? snap.sourceAmountMinor);
            platformFeesChargedMinor += snap.platformSaleCommissionMinor;

            const activeAllocs = ord.withdrawalAllocations.filter(
              (a) => !['cancelled', 'failed'].includes(a.batch.status.toLowerCase())
            );
            const allocatedMinor = activeAllocs.reduce((s, a) => s + a.contributionAmountMinor, 0);
            const netAvailable = Math.max(0, snap.platformOrderNetMinor - allocatedMinor);

            eligibleForBatchMinor += netAvailable;

            const inPendingBatch = activeAllocs.some((a) =>
              ['draft', 'ready', 'submitted', 'processing', 'received', 'review_required'].includes(a.batch.status.toLowerCase())
            );
            if (inPendingBatch || snap.calculationStatus === 'provisional') {
              pendingReconciliationMinor += snap.platformOrderNetMinor;
            }
          }
        }

        // تفکیک شفاف نوع موجودی
        const reportedExternalBalanceMinor = acc.eligibleBalanceMinor + acc.pendingReleaseMinor;
        const confirmedActualFundsMinor = acc.receivedTotalMinor;
        const internalUsdLedgerBalanceMinor = acc.eligibleBalanceMinor + acc.reservedBatchMinor;

        // محاسبه تخمینی عواید برداشت بر اساس سیاست‌های مصوب
        let estimatedProceedsMinor = acc.eligibleBalanceMinor;
        if (acc.platform === 'g2g') {
          // G2G: 3.99% + $0.99 + $0.30 transfer
          const fee = Math.round(acc.eligibleBalanceMinor * 0.0399) + 99 + 30;
          estimatedProceedsMinor = Math.max(0, acc.eligibleBalanceMinor - fee);
        } else if (acc.platform === 'skycoach') {
          // SkyCoach: $0.30 transfer
          estimatedProceedsMinor = Math.max(0, acc.eligibleBalanceMinor - 30);
        } else if (acc.platform === 'eldorado') {
          // Eldorado: $1.50 transfer
          estimatedProceedsMinor = Math.max(0, acc.eligibleBalanceMinor - 150);
        }

        const warnings: string[] = [];
        if (!acc.isEligibleForWithdrawal) {
          warnings.push(`Account balance ($${(acc.eligibleBalanceMinor / 100).toFixed(2)}) is below the platform minimum withdrawal threshold ($${(acc.minWithdrawalThresholdMinor / 100).toFixed(2)})`);
        }
        if (platformBatches.some((b) => b.status === 'review_required')) {
          warnings.push('One or more batches are flagged with REVIEW_REQUIRED due to receipt discrepancies');
        }
        if (acc.pendingReleaseMinor > 0) {
          warnings.push(`$${(acc.pendingReleaseMinor / 100).toFixed(2)} is pending platform escrow/clearing and cannot be withdrawn yet`);
        }

        return {
          ...acc,
          grossRevenueMinor,
          platformFeesChargedMinor,
          eligibleForBatchMinor,
          pendingReconciliationMinor,
          pendingBatchesCount: pendingBatches.length,
          pendingBatchesAmountMinor,
          reconciledBatchesCount: reconciledBatches.length,
          reconciledTotalReceivedMinor,
          reportedExternalBalanceMinor,
          confirmedActualFundsMinor,
          internalUsdLedgerBalanceMinor,
          estimatedProceedsMinor,
          isRealtimeApiConnected: false, // صراحتاً اعلام عدم اتصال خودکار به API
          balanceSource: 'Verified Internal Ledger & Settled Platform Records',
          warnings,
        };
      });

      res.json({
        success: true,
        platforms: platformSummaries,
        systemStatus: {
          realtimeApiConnected: false,
          accountingUnit: 'USD Minor Units (Cents)',
          escrowReleaseEnabled: false,
          liveCreditsEnabled: false,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch platform finance overview' });
    }
  }
);

// ۲. دریافت سفارشات واجد شرایط برای ایجاد دسته برداشت (Eligible Settled External Orders)
router.get(
  '/admin/platform-finance/eligible-orders',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const auth = await authorize(user.discordId, Permission.FINANCE_ADMIN_VIEW);
      if (!auth.allowed) {
        res.status(403).json({ error: auth.reason || 'Insufficient permissions' });
        return;
      }

      const platformFilter = typeof req.query.platform === 'string' ? req.query.platform.toLowerCase() : undefined;

      const orders = await prisma.order.findMany({
        where: {
          sourceWebsite: platformFilter ? platformFilter : { in: ['g2g', 'skycoach', 'eldorado'] },
          status: { in: ['completed', 'assigned', 'in_progress'] },
          paymentStatus: { in: ['verified', 'unneeded'] },
          disputes: {
            none: {
              status: { in: ['open', 'under_review', 'waiting_for_evidence'] },
            },
          },
        },
        include: {
          game: { select: { displayName: true, slug: true } },
          service: { select: { displayName: true, serviceKey: true, serviceMode: true } },
          financialSnapshot: true,
          withdrawalAllocations: {
            include: { batch: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const eligibleOrders = orders
        .map((o) => {
          const snap = o.financialSnapshot;
          if (!snap) return null;

          const activeAllocs = o.withdrawalAllocations.filter(
            (a) => !['cancelled', 'failed'].includes(a.batch.status.toLowerCase())
          );
          const alreadyAllocatedMinor = activeAllocs.reduce((sum, a) => sum + a.contributionAmountMinor, 0);
          const orderNetMinor = snap.platformOrderNetMinor ?? o.grossAmountMinor;
          const remainingAllocatableMinor = Math.max(0, orderNetMinor - alreadyAllocatedMinor);

          if (remainingAllocatableMinor <= 0) return null;

          return {
            orderId: o.id,
            platform: o.sourceWebsite?.toLowerCase(),
            externalOrderId: o.externalOrderId,
            gameName: o.game?.displayName || o.gameSlug,
            serviceName: o.service?.displayName || o.orderName,
            serviceKey: o.service?.serviceKey,
            orderType: o.orderType,
            currency: o.currency,
            grossAmountMinor: o.grossAmountMinor,
            platformSaleCommissionMinor: snap.platformSaleCommissionMinor,
            platformOrderNetMinor: snap.platformOrderNetMinor,
            alreadyAllocatedMinor,
            allocatableMinor: remainingAllocatableMinor,
            calculationStatus: snap.calculationStatus,
            createdAt: o.createdAt,
          };
        })
        .filter(Boolean);

      res.json({ success: true, orders: eligibleOrders });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch eligible orders' });
    }
  }
);

// ۳. پیش‌نمایش محاسبات دسته برداشت (Preview Batch Fees & Minimum Validation)
router.post(
  '/admin/platform-finance/batches/preview',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const auth = await authorize(user.discordId, Permission.FINANCE_ADMIN_VIEW);
      if (!auth.allowed) {
        res.status(403).json({ error: auth.reason || 'Insufficient permissions' });
        return;
      }

      const { platform, orderContributions } = req.body;
      if (!platform || !['g2g', 'skycoach', 'eldorado'].includes(String(platform).toLowerCase())) {
        res.status(400).json({ error: 'Valid platform (g2g, skycoach, eldorado) is required' });
        return;
      }

      if (!Array.isArray(orderContributions) || orderContributions.length === 0) {
        res.status(400).json({ error: 'At least one order contribution is required' });
        return;
      }

      let totalContributionsMinor = 0;
      for (const item of orderContributions) {
        const amt = Number(item.contributionMinor);
        if (isNaN(amt) || amt <= 0 || !Number.isInteger(amt)) {
          res.status(400).json({ error: `Invalid contribution amount for order ${item.orderId}` });
          return;
        }
        totalContributionsMinor += amt;
      }

      const pLower = String(platform).toLowerCase();
      const minThresholdMinor = getPlatformWithdrawalThreshold(pLower);
      const meetsMinimumThreshold = totalContributionsMinor >= minThresholdMinor;

      let estimatedBatchFeeMinor = 0;
      let estimatedTransferFeeMinor = 0;

      if (pLower === 'g2g') {
        // G2G: 3.99% + $0.99 batch fee, $0.30 transfer cost
        estimatedBatchFeeMinor = Math.round(totalContributionsMinor * 0.0399) + 99;
        estimatedTransferFeeMinor = 30;
      } else if (pLower === 'skycoach') {
        // SkyCoach: 10% already reflected in order net, no $5 fee!
        estimatedBatchFeeMinor = 0;
        estimatedTransferFeeMinor = 30;
      } else if (pLower === 'eldorado') {
        // Eldorado: category commission already reflected, $1.50 transfer fee
        estimatedBatchFeeMinor = 0;
        estimatedTransferFeeMinor = 150;
      }

      const expectedNetMinor = Math.max(0, totalContributionsMinor - estimatedBatchFeeMinor - estimatedTransferFeeMinor);

      res.json({
        success: true,
        preview: {
          platform: pLower,
          orderCount: orderContributions.length,
          totalContributionsMinor,
          minThresholdMinor,
          meetsMinimumThreshold,
          estimatedBatchFeeMinor,
          estimatedTransferFeeMinor,
          expectedNetMinor,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to preview batch' });
    }
  }
);

// ۴. ایجاد دسته برداشت در وضعیت پیش‌نویس (Create Draft Withdrawal Batch)
router.post(
  '/admin/platform-finance/batches',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { platform, accountRef, currency = 'USD', orderContributions, notes } = req.body;

      if (!platform || !['g2g', 'skycoach', 'eldorado'].includes(String(platform).toLowerCase())) {
        res.status(400).json({ error: 'Valid platform (g2g, skycoach, eldorado) is required' });
        return;
      }

      if (!Array.isArray(orderContributions) || orderContributions.length === 0) {
        res.status(400).json({ error: 'Order contributions array is required' });
        return;
      }

      const targetAccountRef = accountRef || `${platform.toLowerCase()}_main`;

      const batch = await createDraftWithdrawalBatch({
        platform: platform.toLowerCase() as ExternalPlatform,
        accountRef: targetAccountRef,
        currency,
        orderContributions: orderContributions.map((c: any) => ({
          orderId: Number(c.orderId),
          contributionMinor: Number(c.contributionMinor),
        })),
        actorId: user.discordId,
        notes: notes ? String(notes).trim() : undefined,
      });

      res.status(201).json({ success: true, batch });
    } catch (err: any) {
      const isAuthError = err.message?.startsWith('UNAUTHORIZED');
      res.status(isAuthError ? 403 : 400).json({ error: err.message || 'Failed to create withdrawal batch' });
    }
  }
);

// ۵. دریافت فهرست دسته‌های برداشت با فیلتر (List Withdrawal Batches)
router.get(
  '/admin/platform-finance/batches',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const auth = await authorize(user.discordId, Permission.FINANCE_ADMIN_VIEW);
      if (!auth.allowed) {
        res.status(403).json({ error: auth.reason || 'Insufficient permissions' });
        return;
      }

      const { platform, status } = req.query;

      const where: any = {};
      if (platform && typeof platform === 'string') {
        where.platform = platform.toLowerCase();
      }
      if (status && typeof status === 'string') {
        where.status = status.toLowerCase();
      }

      const batches = await prisma.platformWithdrawalBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          allocations: {
            select: {
              id: true,
              orderId: true,
              contributionAmountMinor: true,
              allocatedBatchFeeMinor: true,
              allocatedTransferFeeMinor: true,
              netContributionMinor: true,
            },
          },
          reconciler: { select: { discordId: true, username: true } },
        },
      });

      res.json({
        success: true,
        batches: batches.map((b) => ({
          ...b,
          orderCount: b.allocations.length,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch withdrawal batches' });
    }
  }
);

// ۶. مشاهده جزئیات دسته و شفافیت تسهیم سهم بوسترها (Batch Details & Booster Allocation Visibility)
router.get(
  '/admin/platform-finance/batches/:id',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const auth = await authorize(user.discordId, Permission.FINANCE_ADMIN_VIEW);
      if (!auth.allowed) {
        res.status(403).json({ error: auth.reason || 'Insufficient permissions' });
        return;
      }

      const batchId = Number(req.params.id);
      if (isNaN(batchId) || batchId <= 0) {
        res.status(400).json({ error: 'Invalid batch ID' });
        return;
      }

      const batch = await prisma.platformWithdrawalBatch.findUnique({
        where: { id: batchId },
        include: {
          allocations: {
            include: {
              order: {
                include: {
                  service: true,
                  financialSnapshot: true,
                  boosterPayoutAllocations: {
                    include: { booster: { select: { discordId: true, username: true, displayName: true } } },
                  },
                  runs: {
                    where: { status: 'completed' },
                    include: {
                      runAssignments: {
                        include: { assignment: { include: { user: { select: { discordId: true, username: true } } } } },
                      },
                    },
                  },
                },
              },
            },
          },
          transactions: { orderBy: { createdAt: 'desc' } },
          reconciler: { select: { discordId: true, username: true } },
        },
      });

      if (!batch) {
        res.status(404).json({ error: `Withdrawal batch #${batchId} not found` });
        return;
      }

      // تحلیل و ساختاردهی شفافیت سهم بوسترها (Booster Allocation Breakdown)
      const orderBreakdown = batch.allocations.map((alloc) => {
        const order = alloc.order;
        const snap = order.financialSnapshot;
        const serviceType = order.orderType; // solo | group | pilot
        const isMythicPlus = (order.service?.serviceKey || '').includes('mythic') || order.orderType === 'group';

        // استخراج بوسترهای شرکت‌کننده تاییدشده
        const verifiedBoosterMap = new Map<string, string>();
        for (const run of order.runs) {
          for (const ra of run.runAssignments) {
            if (ra.assignment?.user) {
              verifiedBoosterMap.set(ra.assignment.user.discordId, ra.assignment.user.username);
            }
          }
        }
        for (const pa of order.boosterPayoutAllocations) {
          if (pa.booster) {
            verifiedBoosterMap.set(pa.booster.discordId, pa.booster.displayName || pa.booster.username);
          }
        }

        const verifiedBoosters = Array.from(verifiedBoosterMap.entries()).map(([id, name]) => ({
          discordId: id,
          username: name,
        }));

        // تخصیص‌های ثبت‌شده واقعی
        const recordedAllocations = order.boosterPayoutAllocations.map((pa) => ({
          boosterId: pa.boosterId,
          boosterName: pa.booster?.displayName || pa.booster?.username || pa.boosterId,
          allocatedMinor: pa.allocatedMinor,
          currency: pa.currency,
          payoutRole: pa.payoutRole,
        }));

        // در صورت عدم ثبت نهایی، محاسبه سهم‌های پیش‌بینی‌شده با روش Largest Remainder
        let projectedAllocations: any[] = [];
        const poolMinor = snap?.boosterPoolMinor ?? Math.max(0, alloc.netContributionMinor - (snap?.g4xFeeMinor ?? 0));
        if (recordedAllocations.length === 0 && verifiedBoosters.length > 0 && poolMinor > 0) {
          const boosterIds = verifiedBoosters.map((b) => b.discordId);
          const split = splitPoolEquallyWithRemainder(poolMinor, boosterIds);
          projectedAllocations = split.map((s) => ({
            boosterId: s.boosterId,
            boosterName: verifiedBoosterMap.get(s.boosterId) || s.boosterId,
            allocatedMinor: s.allocatedMinor,
            currency: batch.currency,
            payoutRole: boosterIds.length === 1 ? 'solo' : 'team_member',
            isProjected: true,
          }));
        }

        return {
          orderId: order.id,
          serviceName: order.service?.displayName || order.orderName,
          serviceKey: order.service?.serviceKey,
          serviceType,
          isMythicPlus,
          orderGrossMinor: order.grossAmountMinor,
          platformDeductionMinor: snap?.platformSaleCommissionMinor ?? 0,
          allocatedBatchFeeMinor: alloc.allocatedBatchFeeMinor,
          allocatedTransferFeeMinor: alloc.allocatedTransferFeeMinor,
          netContributionMinor: alloc.netContributionMinor,
          boosterPoolAvailableMinor: poolMinor,
          verifiedBoostersCount: verifiedBoosters.length,
          verifiedBoosters,
          recordedAllocations,
          projectedAllocations: recordedAllocations.length > 0 ? [] : projectedAllocations,
          isMythicPlusFourBoosterRuleMet: isMythicPlus ? verifiedBoosters.length === 4 : true,
          allocationStatus: order.boosterPayoutAllocations.length > 0
            ? 'finalized'
            : batch.status === 'reconciled'
            ? 'reconciled_pending_booster_split'
            : 'provisional',
        };
      });

      res.json({
        success: true,
        batch: {
          ...batch,
          orderBreakdown,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch batch details' });
    }
  }
);

// ۷. ثبت ارسال دستی درخواست برداشت در پلتفرم (Submit Batch)
router.post(
  '/admin/platform-finance/batches/:id/submit',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const batchId = Number(req.params.id);
      if (isNaN(batchId) || batchId <= 0) {
        res.status(400).json({ error: 'Invalid batch ID' });
        return;
      }

      const { externalReceiptRef, notes } = req.body;

      const updated = await submitWithdrawalBatch(
        batchId,
        user.discordId,
        externalReceiptRef ? String(externalReceiptRef).trim() : undefined,
        notes ? String(notes).trim() : undefined
      );

      res.json({ success: true, batch: updated });
    } catch (err: any) {
      const isAuthError = err.message?.startsWith('UNAUTHORIZED');
      res.status(isAuthError ? 403 : 400).json({ error: err.message || 'Failed to submit batch' });
    }
  }
);

// ۸. ثبت شواهد و وصول واقعی وجوه (Record Batch Receipt & Evidence)
router.post(
  '/admin/platform-finance/batches/:id/record-receipt',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const batchId = Number(req.params.id);
      if (isNaN(batchId) || batchId <= 0) {
        res.status(400).json({ error: 'Invalid batch ID' });
        return;
      }

      const {
        actualReceivedMinor,
        actualBatchFeeMinor,
        actualTransferFeeMinor = 0,
        destinationAccountRef,
        safeEvidenceRef,
        externalReceiptRef,
        reviewNotes,
      } = req.body;

      if (!actualReceivedMinor || Number(actualReceivedMinor) <= 0) {
        res.status(400).json({ error: 'Valid actualReceivedMinor (> 0) is required' });
        return;
      }

      if (!destinationAccountRef || !String(destinationAccountRef).trim()) {
        res.status(400).json({ error: 'Destination account reference is required' });
        return;
      }

      if (!safeEvidenceRef || !String(safeEvidenceRef).trim()) {
        res.status(400).json({ error: 'Safe transaction evidence reference (e.g. TXID / receipt) is required' });
        return;
      }

      const updated = await recordBatchReceipt({
        batchId,
        actualReceivedMinor: Number(actualReceivedMinor),
        actualBatchFeeMinor: Number(actualBatchFeeMinor || 0),
        actualTransferFeeMinor: Number(actualTransferFeeMinor || 0),
        destinationAccountRef: String(destinationAccountRef).trim(),
        safeEvidenceRef: String(safeEvidenceRef).trim(),
        externalReceiptRef: externalReceiptRef ? String(externalReceiptRef).trim() : undefined,
        reviewNotes: reviewNotes ? String(reviewNotes).trim() : undefined,
        actorId: user.discordId,
      });

      res.json({ success: true, batch: updated });
    } catch (err: any) {
      const isAuthError = err.message?.startsWith('UNAUTHORIZED');
      res.status(isAuthError ? 403 : 400).json({ error: err.message || 'Failed to record receipt' });
    }
  }
);

// ۹. تسویه نهایی دسته و اعمال تسهیم قطعی هزینه‌ها (Reconcile Batch)
router.post(
  '/admin/platform-finance/batches/:id/reconcile',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const batchId = Number(req.params.id);
      if (isNaN(batchId) || batchId <= 0) {
        res.status(400).json({ error: 'Invalid batch ID' });
        return;
      }

      const result = await reconcileWithdrawalBatch(batchId, user.discordId);

      res.json({ success: true, ...result });
    } catch (err: any) {
      const isAuthError = err.message?.startsWith('UNAUTHORIZED');
      res.status(isAuthError ? 403 : 400).json({ error: err.message || 'Failed to reconcile batch' });
    }
  }
);

// ۱۰. لغو ایمن دسته پیش‌نویس (Cancel Batch)
router.post(
  '/admin/platform-finance/batches/:id/cancel',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const batchId = Number(req.params.id);
      if (isNaN(batchId) || batchId <= 0) {
        res.status(400).json({ error: 'Invalid batch ID' });
        return;
      }

      const { reason } = req.body;
      if (!reason || String(reason).trim().length < 5) {
        res.status(400).json({ error: 'A valid cancellation reason (minimum 5 characters) is required' });
        return;
      }

      const cancelled = await cancelWithdrawalBatch(batchId, user.discordId, String(reason).trim());

      res.json({ success: true, batch: cancelled });
    } catch (err: any) {
      const isAuthError = err.message?.startsWith('UNAUTHORIZED');
      res.status(isAuthError ? 403 : 400).json({ error: err.message || 'Failed to cancel batch' });
    }
  }
);

// ۱۱. نهایی‌سازی تسهیم استخر بوسترها پس از تسویه دسته (Finalize Booster Allocations)
router.post(
  '/admin/platform-finance/orders/:orderId/finalize-allocations',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const orderId = Number(req.params.orderId);
      if (isNaN(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const { participatingBoosterIds, serviceType } = req.body;

      const result = await finalizeOrderFinancialsAndBoosterAllocation({
        orderId,
        actorId: user.discordId,
        participatingBoosterIds: Array.isArray(participatingBoosterIds) ? participatingBoosterIds : undefined,
        serviceType,
      });

      res.json({ success: true, ...result });
    } catch (err: any) {
      const isAuthError = err.message?.startsWith('UNAUTHORIZED');
      res.status(isAuthError ? 403 : 400).json({ error: err.message || 'Failed to finalize booster allocations' });
    }
  }
);

// ۱۲. تاریخچه ممیزی مالی پلتفرم‌ها (Platform Finance Audit History)
router.get(
  '/admin/platform-finance/audit-history',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const auth = await authorize(user.discordId, Permission.FINANCE_ADMIN_VIEW);
      if (!auth.allowed) {
        res.status(403).json({ error: auth.reason || 'Insufficient permissions' });
        return;
      }

      const logs = await prisma.auditLog.findMany({
        where: {
          OR: [
            { entityType: { in: ['PlatformAccount', 'PlatformWithdrawalBatch', 'OrderWithdrawalAllocation', 'PlatformAccountTransaction'] } },
            { action: { startsWith: 'PLATFORM_' } },
            { action: { in: ['ORDER_FINANCIALS_FINALIZED', 'FINANCIAL_POLICY_UPDATE'] } },
          ],
        },
        include: {
          actor: { select: { discordId: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      res.json({ success: true, history: logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch audit history' });
    }
  }
);

// ─── ۱۳. مدیریت بازی‌ها و کتگوری‌های سرویس‌ها توسط ادمین (Admin Games & Categories) ─────────

// دریافت لیست کامل بازی‌ها همراه با سرویس‌ها و رفرنس‌ها
router.get(
  '/admin/games',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const games = await listAdminGames();
      res.json({ success: true, games });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to list games' });
    }
  }
);

// ایجاد بازی جدید
router.post(
  '/admin/games',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const game = await createGame(req.body, actorId);
      res.status(201).json({ success: true, game });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to create game' });
    }
  }
);

// ویرایش بازی (با محافظت از تغییرناپذیری شناسه در صورت وجود سوابق)
router.put(
  '/admin/games/:slug',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const slug = req.params.slug;
      const game = await updateGame(slug, req.body, actorId);
      res.json({ success: true, game });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to update game' });
    }
  }
);

// فعال / غیرفعال کردن بازی
router.patch(
  '/admin/games/:slug/status',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const slug = req.params.slug;
      const { isActive } = req.body;
      if (typeof isActive !== 'boolean') {
        res.status(400).json({ error: 'isActive boolean is required' });
        return;
      }
      const game = await toggleGameStatus(slug, isActive, actorId);
      res.json({ success: true, game });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to toggle game status' });
    }
  }
);

// مرتب‌سازی بازی‌ها
router.post(
  '/admin/games/reorder',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const items = req.body.items || (Array.isArray(req.body.orderedSlugs)
        ? req.body.orderedSlugs.map((slug: string, idx: number) => ({ slug, sortOrder: idx }))
        : req.body);
      const result = await reorderGames(items, actorId);
      res.json(result);
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to reorder games' });
    }
  }
);

// حذف ایمن بازی (ممنوعیت در صورت داشتن رکوردهای تاریخی)
router.delete(
  '/admin/games/:slug',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const slug = req.params.slug;
      const result = await deleteGame(slug, actorId);
      res.json(result);
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to delete game' });
    }
  }
);

// ایجاد کتگوری/سرویس جدید برای بازی
router.post(
  '/admin/games/:slug/services',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const gameSlug = req.params.slug;
      const service = await createGameService(gameSlug, req.body, actorId);
      res.status(201).json({ success: true, service });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to create service category' });
    }
  }
);

// ویرایش کتگوری/سرویس و تنظیمات آن
router.put(
  '/admin/services/:id',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid service ID' });
        return;
      }
      const service = await updateGameService(id, req.body, actorId);
      res.json({ success: true, service });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to update service category' });
    }
  }
);

// فعال / غیرفعال کردن کتگوری/سرویس
router.patch(
  '/admin/services/:id/status',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid service ID' });
        return;
      }
      const { isActive } = req.body;
      if (typeof isActive !== 'boolean') {
        res.status(400).json({ error: 'isActive boolean is required' });
        return;
      }
      const service = await toggleGameServiceStatus(id, isActive, actorId);
      res.json({ success: true, service });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to toggle service status' });
    }
  }
);

// مرتب‌سازی کتگوری‌ها/سرویس‌ها
router.post(
  '/admin/services/reorder',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const items = req.body.items || (Array.isArray(req.body.orderedServiceIds)
        ? req.body.orderedServiceIds.map((id: number, idx: number) => ({ id, sortOrder: idx }))
        : req.body);
      const result = await reorderGameServices(items, actorId);
      res.json(result);
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to reorder services' });
    }
  }
);

// حذف ایمن کتگوری/سرویس (ممنوعیت در صورت داشتن رکوردهای تاریخی)
router.delete(
  '/admin/services/:id',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid service ID' });
        return;
      }
      const result = await deleteGameService(id, actorId);
      res.json(result);
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to delete service category' });
    }
  }
);

// ─── ۴۰. مدیریت و همگام‌سازی خودکار کانال‌های دیسکورد (Admin Discord Channels) ─────

// دریافت لیست کامل نگاشت کانال‌های دیسکورد به همراه وضعیت همگام‌سازی و آمار
router.get(
  '/admin/discord/channels',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { guildId, categoryName, syncStatus, gameSlug } = req.query;
      const mappings = await listChannelMappings({
        guildId: guildId ? String(guildId) : undefined,
        categoryName: categoryName ? String(categoryName) : undefined,
        syncStatus: syncStatus ? String(syncStatus) : undefined,
        gameSlug: gameSlug ? String(gameSlug) : undefined,
      });

      const stats = {
        total: mappings.length,
        synced: mappings.filter((m) => m.syncStatus === 'SYNCED').length,
        manual: mappings.filter((m) => m.syncStatus === 'MANUAL').length,
        missing: mappings.filter((m) => m.syncStatus === 'MISSING').length,
        invalid: mappings.filter((m) => m.syncStatus === 'INVALID').length,
        disabled: mappings.filter((m) => m.syncStatus === 'DISABLED').length,
      };

      res.json({ success: true, mappings, stats });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to load Discord channel mappings' });
    }
  }
);

// راه‌اندازی و همگام‌سازی خودکار کلیه کانال‌ها و دسته‌بندی‌های دیسکورد
router.post(
  '/admin/discord/provision',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const { client } = await import('../index');
      const guild = resolveExecutionGuild(client, req.body.guildId);

      if (!guild) {
        res.status(400).json({
          error: 'Discord Bot Guild is not currently connected. Please ensure bot is online and DISCORD_GUILD_ID is configured.',
        });
        return;
      }

      const result = await provisionAllChannels({
        guild,
        actorId,
        client,
      });

      res.json(result);
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to provision Discord channels' });
    }
  }
);

// تطبیق مجدد وضعیت کانال‌های دیتابیس با دیسکورد
router.post(
  '/admin/discord/reconcile',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const { client } = await import('../index');
      const guild = resolveExecutionGuild(client, req.body.guildId);

      if (!guild) {
        res.status(400).json({
          error: 'Discord Bot Guild is not currently connected.',
        });
        return;
      }

      const result = await reconcileChannelMappings({
        guild,
        actorId,
      });

      res.json({ success: true, result });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to reconcile Discord channels' });
    }
  }
);

// اعتبارسنجی یک شناسه کانال در سرور دیسکورد بدون ایجاد تغییر
router.post(
  '/admin/discord/channels/validate',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId, expectedType, guildId } = req.body;
      if (!channelId || typeof channelId !== 'string') {
        res.status(400).json({ error: 'channelId string is required' });
        return;
      }

      const { client } = await import('../index');
      const guild = resolveExecutionGuild(client, guildId);

      if (!guild) {
        res.status(400).json({
          error: 'Discord Bot Guild is not currently connected for channel validation.',
        });
        return;
      }

      const validation = await validateDiscordChannel(channelId, guild, expectedType);
      res.json({ success: true, validation });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to validate Discord channel' });
    }
  }
);

// ویرایش دستی شناسه کانال (قانون حیاتی: هرگز کانال قبلی در دیسکورد حذف نمی‌شود)
router.put(
  '/admin/discord/channels/:key',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const channelKey = req.params.key;
      const { discordChannelId, validateGuild, guildId } = req.body;

      if (!discordChannelId || typeof discordChannelId !== 'string') {
        res.status(400).json({ error: 'discordChannelId string is required' });
        return;
      }

      let guild: any = null;
      if (validateGuild !== false) {
        const { client } = await import('../index');
        guild = resolveExecutionGuild(client, guildId);
      }

      const mapping = await updateChannelMapping({
        channelKey,
        newChannelId: discordChannelId,
        actorId,
        guild,
      });

      res.json({ success: true, mapping });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to update channel mapping' });
    }
  }
);

// تعمیر خودکار یک کانال نامعتبر یا گم‌شده
router.post(
  '/admin/discord/channels/:key/repair',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const channelKey = req.params.key;

      const { client } = await import('../index');
      const guild = resolveExecutionGuild(client, req.body.guildId);

      if (!guild) {
        res.status(400).json({
          error: 'Discord Bot Guild is not currently connected to repair channel.',
        });
        return;
      }

      const mapping = await repairChannelMapping({
        channelKey,
        guild,
        actorId,
      });

      res.json({ success: true, mapping });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to repair channel mapping' });
    }
  }
);

// فعال یا غیرفعال کردن یک نگاشت اختیاری
router.patch(
  '/admin/discord/channels/:key/status',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const channelKey = req.params.key;
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        res.status(400).json({ error: 'isActive boolean is required' });
        return;
      }

      const mapping = await toggleChannelMappingStatus({
        channelKey,
        isActive,
        actorId,
      });

      res.json({ success: true, mapping });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to toggle channel mapping status' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// بخش مدیریت کاربران در پنل ادمین (Admin User Management)
// ─────────────────────────────────────────────────────────────────────────────

// ۱. فهرست کاربران با صفحه‌بندی، جستجو و فیلتر
router.get(
  '/admin/users',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = (req.query.search as string) || '';
      const role = (req.query.role as string) || '';
      const approvalStatus = (req.query.approvalStatus as string) || '';
      const accountStatus = (req.query.accountStatus as any) || 'all';

      const result = await listAdminUsers({
        page,
        limit,
        search,
        role,
        approvalStatus,
        accountStatus,
      });

      res.json({ success: true, ...result });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to list users' });
    }
  }
);

// ۲. مشاهده پروفایل جامع کاربر
router.get(
  '/admin/users/:discordId',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const discordId = req.params.discordId;
      const profile = await getAdminUserProfile(discordId);
      res.json({ success: true, profile });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to fetch user profile' });
    }
  }
);

// ۲.۱. تاریخچه تغییر وضعیت و مسدودسازی کاربر
router.get(
  '/admin/users/:discordId/ban-history',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const discordId = req.params.discordId;
      const history = await getUserBanHistory(discordId);
      res.json({ success: true, history });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to fetch user ban history' });
    }
  }
);

// ۳. تعلیق یا فعال‌سازی مجدد کاربر
router.post(
  '/admin/users/:discordId/status',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const targetUserId = req.params.discordId;
      const { isActive, reason } = req.body;

      if (typeof isActive !== 'boolean') {
        res.status(400).json({ error: 'isActive boolean is required' });
        return;
      }
      if (!reason || typeof reason !== 'string') {
        res.status(400).json({ error: 'Audit reason string is required' });
        return;
      }

      const result = await updateUserAccountStatus({
        targetUserId,
        actorId,
        isActive,
        reason,
      });

      res.json(result);
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to update user status' });
    }
  }
);

// ۴. تخصیص یا سلب رول (فقط ادمین و مالک؛ منیجر فاقد دسترسی انتساب نقش است)
router.post(
  '/admin/users/:discordId/roles',
  requireAuth,
  requireRole('owner', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const targetUserId = req.params.discordId;
      const { roleKey, action, reason } = req.body;

      if (!roleKey || typeof roleKey !== 'string') {
        res.status(400).json({ error: 'roleKey string is required' });
        return;
      }
      if (action !== 'grant' && action !== 'revoke') {
        res.status(400).json({ error: "action must be 'grant' or 'revoke'" });
        return;
      }
      if (!reason || typeof reason !== 'string') {
        res.status(400).json({ error: 'Audit reason string is required' });
        return;
      }

      let discordClient: any = null;
      try {
        const { client } = await import('../index');
        discordClient = client;
      } catch (_) {}

      const result = await assignOrRevokeUserRole({
        targetUserId,
        actorId,
        roleKey,
        action,
        reason,
        discordClient,
      });

      res.json(result);
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to update user role' });
    }
  }
);

// ۵. بررسی و تعیین تکلیف درخواست عضویت کاربر از طریق سرویس موجود
router.post(
  '/admin/users/:discordId/applications/:appId/review',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const applicationId = parseInt(req.params.appId);
      const { decision, reason, reviewNotes } = req.body;

      if (isNaN(applicationId)) {
        res.status(400).json({ error: 'Valid applicationId is required' });
        return;
      }
      if (!decision) {
        res.status(400).json({ error: 'Review decision is required' });
        return;
      }

      let discordClient: any = null;
      try {
        const { client } = await import('../index');
        discordClient = client;
      } catch (_) {}

      const application = await reviewApplication({
        reviewerId: actorId,
        applicationId,
        decision,
        reason,
        reviewNotes,
        discordClient,
      });

      res.json({ success: true, application });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to review application' });
    }
  }
);

// ۶. لاگ‌های ممیزی کاربر
router.get(
  '/admin/users/:discordId/audit',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const discordId = req.params.discordId;
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await getUserAuditLogs(discordId, limit);
      res.json({ success: true, logs });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to fetch user audit logs' });
    }
  }
);

// ۷. حذف امن کاربر (با ممانعت صریح در صورت داشتن سوابق تاریخی یا مالی)
router.delete(
  '/admin/users/:discordId',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const targetUserId = req.params.discordId;
      const { reason } = req.body;

      if (!reason || typeof reason !== 'string') {
        res.status(400).json({ error: 'Audit reason string is required' });
        return;
      }

      const result = await deleteUserSafely({
        targetUserId,
        actorId,
        reason,
      });

      res.json(result);
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to delete user' });
    }
  }
);
