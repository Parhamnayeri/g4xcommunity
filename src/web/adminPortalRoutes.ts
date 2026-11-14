/**
 * src/web/adminPortalRoutes.ts — Admin Operations & Platform Oversight API (Website Phase 8)
 * 
 * Responsibilities:
 *  - Real platform metrics & operational health KPIs
 *  - User search, profile inspection, role & account status moderation
 *  - Order escalation and dispute resolution oversight
 *  - Booster, Pilot, Advertiser, and Exchanger application oversight
 *  - Manual IRT deposit review queue & withdrawal queue integration
 *  - Marketplace exchange trade and offer oversight
 *  - Complete platform audit activity exploration
 *  - Read-only feature gate indicators
 *  - Enforces strict server-authoritative RBAC permissions (no automatic Owner privilege inheritance)
 */

import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../database/db';
import { requireAuth, requireCsrf, AuthenticatedRequest } from './middleware/auth';
import { authorize } from '../services/authorizationService';
import { Permission, SystemRoleKey, ROLE_PERMISSIONS } from '../services/permissionTypes';
import { adminReviewFunding } from '../services/financeV2/walletPageService';
import { getOrCreatePlatformAccount } from '../services/platformBalanceService';
import { getUserKycStatus, assistUserKyc, sendKycRequestDm } from '../services/kycDocumentSecurity';

export const adminPortalRouter = Router();

/**
 * Ensures caller holds active Admin, Manager, or Owner role.
 * Does not inherit Owner-only privileges.
 */
export async function requireAdminPortalAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = (req as AuthenticatedRequest).user;
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication session required' });
    return;
  }

  const userRoles = (user.userRoles || []).map((r) => r.roleKey as string);
  const isAuthorized = userRoles.some((r) => ['owner', 'manager', 'admin'].includes(r));

  if (!isAuthorized) {
    res.status(403).json({
      error: 'ADMIN_ACCESS_DENIED',
      message: 'Access restricted to authorized Admin, Manager, or Owner personnel.',
    });
    return;
  }

  next();
}

/**
 * Mask sensitive banking references for administrative privacy.
 */
function maskCard(card?: string | null): string {
  if (!card) return '';
  const clean = card.replace(/[\s-]/g, '');
  if (clean.length < 10) return '****';
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-****-${clean.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. REAL PLATFORM METRICS & OPERATIONAL OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

adminPortalRouter.get(
  '/admin/overview',
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const userRoles = (user.userRoles || []).map((r) => r.roleKey);

      const [
        totalUsers,
        activeUsers,
        roleRecords,
        pendingApps,
        appsByCategory,
        openDisputes,
        pendingProofs,
        ordersSummary,
        pendingDeposits,
        pendingWithdrawals,
        recentAudits,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.userRole.groupBy({ by: ['roleKey'], _count: { userId: true } }),
        prisma.registrationApplication.count({
          where: { status: { in: ['pending', 'awaiting_identity_verification', 'under_review'] } },
        }),
        prisma.registrationApplication.groupBy({
          by: ['category', 'status'],
          _count: { id: true },
        }),
        prisma.orderDispute.count({ where: { status: 'OPEN' } }),
        prisma.runProof.count({ where: { status: 'pending' } }),
        prisma.order.groupBy({
          by: ['status'],
          _count: { id: true },
        }),
        prisma.advertiserFundingRequest.aggregate({
          where: { status: 'PENDING_ADMIN_VERIFICATION' },
          _count: { id: true },
          _sum: { targetUsdCents: true },
        }),
        prisma.boosterWithdrawalRequest.aggregate({
          where: { status: { in: ['RESERVED', 'PROCESSING', 'QUOTED', 'UNDER_ADMIN_REVIEW'] } },
          _count: { id: true },
          _sum: { requestedUsdCents: true },
        }),
        prisma.auditLog.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            actorId: true,
            action: true,
            entityType: true,
            entityId: true,
            isSuccess: true,
            createdAt: true,
          },
        }),
      ]);

      const roleCounts: Record<string, number> = {};
      for (const r of roleRecords) {
        roleCounts[r.roleKey] = r._count.userId;
      }

      const orderCounts: Record<string, number> = {};
      for (const o of ordersSummary) {
        orderCounts[o.status] = o._count.id;
      }

      // Read-only feature-gate states
      const featureGates = {
        ESCROW_RELEASE_ENABLED: process.env.ESCROW_RELEASE_ENABLED === 'true',
        FINANCE_V2_LIVE_CREDITS_ENABLED: process.env.FINANCE_V2_LIVE_CREDITS_ENABLED === 'true',
        FINANCE_V2_LIVE_PAYOUTS_ENABLED: process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED === 'true',
        FINANCE_V2_P2P_SETTLEMENT_ENABLED: process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED === 'true',
        NOWPAYMENTS_LIVE_COLLECTION_ENABLED: process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED === 'true',
      };

      res.json({
        success: true,
        currentUser: {
          discordId: user.discordId,
          username: user.username,
          displayName: user.displayName,
          roles: userRoles,
        },
        kpis: {
          totalUsers,
          activeUsers,
          deactivatedUsers: totalUsers - activeUsers,
          roleCounts,
          pendingApplications: pendingApps,
          applicationsByCategory: appsByCategory,
          openDisputes,
          pendingProofs,
          orderCounts,
          pendingDeposits: {
            count: pendingDeposits._count?.id || 0,
            sumUsdCents: pendingDeposits._sum?.targetUsdCents || 0,
          },
          pendingWithdrawals: {
            count: pendingWithdrawals._count?.id || 0,
            sumUsdCents: pendingWithdrawals._sum?.requestedUsdCents || 0,
          },
        },
        featureGates,
        recentAudits,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'METRICS_FETCH_FAILED', message: err.message || 'Failed to fetch overview metrics' });
    }
  }
);

/**
 * Format integer minor units (USD cents) to clean "$X,XXX.XX" strings.
 */
function formatCentsToUsd(cents: number): string {
  const isNeg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return isNeg ? `-$${dollars}` : `$${dollars}`;
}

const PLATFORMS_CONFIG = [
  { source: 'direct', displayName: 'G4X Direct', icon: '⚡', feeRatePercent: 'Variable / Tiered' },
  { source: 'g2g', displayName: 'G2G Marketplace', icon: '🛒', feeRatePercent: '8.99%' },
  { source: 'skycoach', displayName: 'SkyCoach', icon: '✈️', feeRatePercent: '13%' },
  { source: 'eldorado', displayName: 'Eldorado', icon: '🏰', feeRatePercent: '1.5% - 10%' },
  { source: 'kingboost', displayName: 'Kingboost', icon: '👑', feeRatePercent: '13%' },
  { source: 'overgear', displayName: 'Overgear', icon: '⚙️', feeRatePercent: '13%' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1.1 AUTHORITATIVE FINANCIAL OVERVIEW & PER-PLATFORM METRICS
// ─────────────────────────────────────────────────────────────────────────────

adminPortalRouter.get(
  ['/admin/finance/overview', '/api/admin/finance/overview'],
  requireAuth,
  requireAdminPortalAccess,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      // Ensure default accounts exist for all 5 external platforms
      await Promise.all([
        getOrCreatePlatformAccount('g2g_main', 'g2g', 'G2G (Main Store)'),
        getOrCreatePlatformAccount('skycoach_main', 'skycoach', 'SkyCoach (Main)'),
        getOrCreatePlatformAccount('eldorado_main', 'eldorado', 'Eldorado (Main Store)'),
        getOrCreatePlatformAccount('kingboost_main', 'kingboost', 'Kingboost (Main)'),
        getOrCreatePlatformAccount('overgear_main', 'overgear', 'Overgear (Main)'),
      ]);

      const [orders, platformAccounts, walletAgg, pendingWithdrawals, paidWithdrawals] = await Promise.all([
        prisma.order.findMany({
          select: {
            id: true,
            orderRef: true,
            status: true,
            paymentStatus: true,
            sourceWebsite: true,
            creatorType: true,
            currency: true,
            grossAmountMinor: true,
            platformFeeMinor: true,
            advertiserFeeMinor: true,
            boosterPoolMinor: true,
            createdAt: true,
          },
        }),
        prisma.platformAccount.findMany(),
        prisma.walletV2.aggregate({
          _sum: {
            availableCents: true,
            reservedCents: true,
            pendingEarningsCents: true,
            confirmedEarningsCents: true,
            paidCents: true,
          },
        }),
        prisma.boosterWithdrawalRequest.aggregate({
          where: {
            status: { in: ['RESERVED', 'PROCESSING', 'QUOTED', 'UNDER_ADMIN_REVIEW', 'REQUESTED', 'USER_CONFIRMED'] },
          },
          _sum: { requestedUsdCents: true },
          _count: { id: true },
        }),
        prisma.boosterWithdrawalRequest.aggregate({
          where: { status: 'PAID' },
          _sum: { requestedUsdCents: true },
          _count: { id: true },
        }),
      ]);

      const byPlatform = PLATFORMS_CONFIG.map((cfg) => {
        const isDirect = cfg.source === 'direct';
        const platformOrders = orders.filter((o) => {
          const rawSrc = (o.sourceWebsite || '').trim().toLowerCase();
          if (isDirect) {
            return !rawSrc || rawSrc === 'direct' || !['g2g', 'skycoach', 'eldorado', 'kingboost', 'overgear'].includes(rawSrc);
          }
          return rawSrc === cfg.source;
        });

        const matchingAccounts = platformAccounts.filter(
          (acc) => acc.platform.toLowerCase() === cfg.source
        );

        const totalOrders = platformOrders.length;
        const activeOrders = platformOrders.filter((o) =>
          ['open_presign', 'presign_closed', 'assigned', 'in_progress'].includes(o.status.toLowerCase())
        ).length;
        const completedOrders = platformOrders.filter(
          (o) => o.status.toLowerCase() === 'completed'
        ).length;
        const cancelledOrders = platformOrders.filter(
          (o) => ['cancelled', 'rejected'].includes(o.status.toLowerCase())
        ).length;

        const validOrders = platformOrders.filter(
          (o) => !['cancelled', 'rejected'].includes(o.status.toLowerCase())
        );

        const grossVolumeMinor = validOrders.reduce((sum, o) => sum + (o.grossAmountMinor || 0), 0);
        const feeDeductedMinor = validOrders.reduce((sum, o) => sum + (o.platformFeeMinor || 0), 0);
        const boosterPoolMinor = validOrders.reduce((sum, o) => sum + (o.boosterPoolMinor || 0), 0);
        const netRevenueMinor = isDirect
          ? validOrders.reduce((sum, o) => sum + (o.platformFeeMinor || 0) + (o.advertiserFeeMinor || 0), 0)
          : feeDeductedMinor;

        const accEligible = matchingAccounts.reduce((sum, acc) => sum + (acc.eligibleBalanceMinor || 0), 0);
        const accPending = matchingAccounts.reduce((sum, acc) => sum + (acc.pendingReleaseMinor || 0), 0);
        const accWithdrawn = matchingAccounts.reduce((sum, acc) => sum + (acc.withdrawnTotalMinor || 0), 0);
        const accReceived = matchingAccounts.reduce((sum, acc) => sum + (acc.receivedTotalMinor || 0), 0);

        const availableBalanceMinor = isDirect
          ? Math.max(0, netRevenueMinor)
          : accEligible;

        const pendingReleaseMinor = isDirect
          ? platformOrders
              .filter((o) => ['open_presign', 'presign_closed', 'assigned', 'in_progress'].includes(o.status.toLowerCase()))
              .reduce((sum, o) => sum + (o.grossAmountMinor || 0), 0)
          : accPending;

        return {
          source: cfg.source,
          displayName: cfg.displayName,
          icon: cfg.icon,
          feeRatePercent: cfg.feeRatePercent,
          orderCounts: {
            total: totalOrders,
            active: activeOrders,
            completed: completedOrders,
            cancelled: cancelledOrders,
          },
          grossVolumeMinor,
          grossVolumeUsd: formatCentsToUsd(grossVolumeMinor),
          feeDeductedMinor,
          feeDeductedUsd: formatCentsToUsd(feeDeductedMinor),
          netRevenueMinor,
          netRevenueUsd: formatCentsToUsd(netRevenueMinor),
          boosterPoolMinor,
          boosterPoolUsd: formatCentsToUsd(boosterPoolMinor),
          availableBalanceMinor,
          availableBalanceUsd: formatCentsToUsd(availableBalanceMinor),
          pendingReleaseMinor,
          pendingReleaseUsd: formatCentsToUsd(pendingReleaseMinor),
          withdrawnTotalMinor: accWithdrawn,
          withdrawnTotalUsd: formatCentsToUsd(accWithdrawn),
          receivedTotalMinor: accReceived,
          receivedTotalUsd: formatCentsToUsd(accReceived),
        };
      });

      const totalGrossVolumeMinor = byPlatform.reduce((sum, p) => sum + p.grossVolumeMinor, 0);
      const totalPlatformFeesMinor = byPlatform.reduce((sum, p) => sum + p.feeDeductedMinor, 0);
      const totalNetPlatformProfitMinor = byPlatform.reduce((sum, p) => sum + p.netRevenueMinor, 0);
      const totalBoosterPoolMinor = byPlatform.reduce((sum, p) => sum + p.boosterPoolMinor, 0);

      const activeEscrowMinor = orders
        .filter((o) => ['open_presign', 'presign_closed', 'assigned', 'in_progress'].includes(o.status.toLowerCase()))
        .reduce((sum, o) => sum + (o.grossAmountMinor || 0), 0);

      const completedVolumeMinor = orders
        .filter((o) => o.status.toLowerCase() === 'completed')
        .reduce((sum, o) => sum + (o.grossAmountMinor || 0), 0);

      const boosterWalletLiabilityMinor =
        (walletAgg._sum.availableCents || 0) + (walletAgg._sum.reservedCents || 0);

      const pendingWithdrawalsCount = pendingWithdrawals._count?.id || 0;
      const pendingWithdrawalsMinor = pendingWithdrawals._sum?.requestedUsdCents || 0;
      const paidWithdrawalsCount = paidWithdrawals._count?.id || 0;
      const paidWithdrawalsMinor = paidWithdrawals._sum?.requestedUsdCents || 0;

      const totalAvailableLiquidMinor = byPlatform.reduce((sum, p) => sum + p.availableBalanceMinor, 0);
      const netLiquidReserveMinor = totalAvailableLiquidMinor - pendingWithdrawalsMinor;

      const totals = {
        grossVolumeMinor: totalGrossVolumeMinor,
        grossVolumeUsd: formatCentsToUsd(totalGrossVolumeMinor),
        platformFeesMinor: totalPlatformFeesMinor,
        platformFeesUsd: formatCentsToUsd(totalPlatformFeesMinor),
        netPlatformProfitMinor: totalNetPlatformProfitMinor,
        netPlatformProfitUsd: formatCentsToUsd(totalNetPlatformProfitMinor),
        boosterPoolMinor: totalBoosterPoolMinor,
        boosterPoolUsd: formatCentsToUsd(totalBoosterPoolMinor),
        activeEscrowMinor,
        activeEscrowUsd: formatCentsToUsd(activeEscrowMinor),
        completedVolumeMinor,
        completedVolumeUsd: formatCentsToUsd(completedVolumeMinor),
        boosterWalletLiabilityMinor,
        boosterWalletLiabilityUsd: formatCentsToUsd(boosterWalletLiabilityMinor),
        pendingWithdrawalsCount,
        pendingWithdrawalsMinor,
        pendingWithdrawalsUsd: formatCentsToUsd(pendingWithdrawalsMinor),
        paidWithdrawalsCount,
        paidWithdrawalsMinor,
        paidWithdrawalsUsd: formatCentsToUsd(paidWithdrawalsMinor),
        netLiquidReserveMinor,
        netLiquidReserveUsd: formatCentsToUsd(netLiquidReserveMinor),
      };

      res.json({
        success: true,
        totals,
        byPlatform,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'FINANCE_OVERVIEW_FAILED', message: err.message || 'Failed to fetch finance overview' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. MANUAL IRT & CRYPTO DEPOSIT QUEUE OVERSIGHT
// ─────────────────────────────────────────────────────────────────────────────

export function serializeAdminDepositItem(r: any) {
  const notes = r.adminNotes || '';
  const receiptMatch = notes.match(/(?:^|\|\s*)Receipt:\s*([^\s|]+)/i);
  const extractedReceiptKey = receiptMatch ? receiptMatch[1].trim() : null;

  const dateMatch = notes.match(/(?:^|\|\s*)Date:\s*([^\s|]+)/i);
  const extractedDate = dateMatch ? dateMatch[1].trim() : null;

  const cardMatch = notes.match(/(?:^|\|\s*)CardLast4:\s*([^\s|]+)/i);
  const extractedCardLast4 = cardMatch ? cardMatch[1].trim() : null;

  const payerDescription = notes
    .replace(/(?:^|\|\s*)Receipt:\s*[^\s|]+/gi, '')
    .replace(/(?:^|\|\s*)Date:\s*[^\s|]+/gi, '')
    .replace(/(?:^|\|\s*)CardLast4:\s*[^\s|]+/gi, '')
    .replace(/\|\s*\|/g, '|')
    .replace(/^\|\s*|\s*\|$/g, '')
    .trim() || null;

  const attempts = r.paymentRequests?.flatMap((pr: any) => pr.attempts) || [];
  const attempt = attempts.find((a: any) => a.method === 'CARD_TO_CARD_IRT') || attempts[0];

  const receiptFileKey = extractedReceiptKey || (attempt?.receiptScreenshotUrl ? attempt.receiptScreenshotUrl.replace('/api/wallet/receipts/', '') : null);
  const receiptUrl = receiptFileKey ? `/api/wallet/receipts/${receiptFileKey}` : (attempt?.receiptScreenshotUrl || null);
  const senderCardLast4 = attempt?.senderCardLast4 || extractedCardLast4 || null;
  const paymentDate = extractedDate || (attempt?.createdAt ? new Date(attempt.createdAt).toISOString().split('T')[0] : null);

  return {
    id: r.id,
    fundingRef: r.fundingRef,
    quoteRef: r.quoteRef,
    advertiserId: r.advertiserId,
    advertiserName: r.advertiser?.displayName || r.advertiser?.username || r.advertiserId,
    fundingMethod: r.fundingMethod,
    status: r.status,
    targetUsdCents: r.targetUsdCents,
    targetUsdFormatted: `$${(r.targetUsdCents / 100).toFixed(2)}`,
    externalCurrency: r.externalCurrency,
    externalAmountUnits: r.externalAmountUnits,
    exchangeRate: r.exchangeRate,
    evidenceRef: r.evidenceRef,
    payerIdentifier: maskCard(r.payerIdentifier),
    rawPayerIdentifier: r.payerIdentifier,
    adminNotes: r.adminNotes,
    receiptFileKey,
    receiptUrl,
    senderCardLast4,
    paymentDate,
    payerDescription,
    verifiedBy: r.verifier?.displayName || r.verifier?.username || r.verifiedBy,
    verifiedAt: r.verifiedAt,
    creditedAt: r.creditedAt,
    createdAt: r.createdAt,
  };
}

adminPortalRouter.get(
  '/admin/deposits',
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'PENDING_ADMIN_VERIFICATION';
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const applicant = typeof req.query.applicant === 'string' ? req.query.applicant.trim() : '';
      const startDate = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : '';
      const endDate = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : '';

      const whereClause: any = {};
      if (status && status !== 'all') {
        whereClause.status = status;
      }
      if (applicant) {
        whereClause.advertiserId = applicant;
      }
      if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate) whereClause.createdAt.gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          whereClause.createdAt.lte = end;
        }
      }
      if (search) {
        const searchConditions: any[] = [
          { fundingRef: { contains: search } },
          { advertiserId: { contains: search } },
          { payerIdentifier: { contains: search } },
          { evidenceRef: { contains: search } },
          { advertiser: { username: { contains: search } } },
        ];
        if (!isNaN(Number(search))) {
          searchConditions.push({ id: Number(search) });
        }
        whereClause.OR = searchConditions;
      }

      const [total, requests] = await Promise.all([
        prisma.advertiserFundingRequest.count({ where: whereClause }),
        prisma.advertiserFundingRequest.findMany({
          where: whereClause,
          include: {
            advertiser: {
              select: { discordId: true, username: true, displayName: true },
            },
            verifier: {
              select: { discordId: true, username: true, displayName: true },
            },
            paymentRequests: {
              include: { attempts: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      const serialized = requests.map(serializeAdminDepositItem);

      res.json({
        success: true,
        deposits: serialized,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: 'DEPOSIT_QUEUE_FAILED', message: err.message || 'Failed to fetch deposits' });
    }
  }
);

adminPortalRouter.get(
  '/admin/deposits/:id',
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const fundingId = parseInt(req.params.id, 10);
      if (isNaN(fundingId) || fundingId <= 0) {
        res.status(400).json({ error: 'INVALID_ID', message: 'Valid deposit ID required' });
        return;
      }

      const deposit = await prisma.advertiserFundingRequest.findUnique({
        where: { id: fundingId },
        include: {
          advertiser: {
            select: { discordId: true, username: true, displayName: true },
          },
          verifier: {
            select: { discordId: true, username: true, displayName: true },
          },
          paymentRequests: {
            include: { attempts: true },
          },
        },
      });

      if (!deposit) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Deposit request not found' });
        return;
      }

      const auditLogs = await prisma.auditLog.findMany({
        where: {
          entityType: 'AdvertiserFundingRequest',
          entityId: String(fundingId),
        },
        include: {
          actor: { select: { discordId: true, username: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        deposit: serializeAdminDepositItem(deposit),
        auditTrail: auditLogs.map((a) => ({
          id: a.id,
          actorId: a.actorId,
          actor: a.actor?.displayName || a.actor?.username || a.actorId || 'System',
          action: a.action,
          reason: a.reason,
          previousValues: a.previousValues,
          newValues: a.newValues,
          createdAt: a.createdAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'DEPOSIT_FETCH_FAILED', message: err.message || 'Failed to fetch deposit' });
    }
  }
);

// Review deposit mutation (reuses existing adminReviewFunding with live gate safety)
adminPortalRouter.post(
  '/admin/deposits/:id/review',
  requireAuth,
  requireAdminPortalAccess,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const fundingId = parseInt(req.params.id, 10);
      const { action, notes } = req.body;

      if (isNaN(fundingId) || fundingId <= 0) {
        res.status(400).json({ error: 'INVALID_ID', message: 'Valid deposit ID required' });
        return;
      }

      if (action !== 'APPROVE' && action !== 'REJECT') {
        res.status(400).json({ error: 'INVALID_ACTION', message: "Action must be 'APPROVE' or 'REJECT'" });
        return;
      }

      // Recheck live MANUAL_DEPOSIT_REVIEW (Admin & Owner only; Management rejected)
      const auth = await authorize(user.discordId, Permission.MANUAL_DEPOSIT_REVIEW);
      if (!auth.allowed) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Manual IRT deposit review requires Admin or Owner permission' });
        return;
      }

      // If action is APPROVE, check whether live credits are enabled
      if (action === 'APPROVE' && process.env.FINANCE_V2_LIVE_CREDITS_ENABLED !== 'true') {
        res.status(409).json({
          error: 'FINANCE_GATE_DISABLED',
          message: 'Live wallet crediting is currently disabled (FINANCE_V2_LIVE_CREDITS_ENABLED=false). Approval cannot credit live balances.',
          gate: 'FINANCE_V2_LIVE_CREDITS_ENABLED',
        });
        return;
      }

      const result = await adminReviewFunding(fundingId, user.discordId, action, notes);
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(400).json({ error: 'DEPOSIT_REVIEW_FAILED', message: err.message || 'Failed to review deposit' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. EXCHANGE TRADE & OFFER OVERSIGHT
// ─────────────────────────────────────────────────────────────────────────────

adminPortalRouter.get(
  '/admin/exchange/trades',
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

      const whereClause: any = {};
      if (status && status !== 'all') {
        whereClause.tradeStatus = status;
      }

      const [total, trades] = await Promise.all([
        prisma.goldTrade.count({ where: whereClause }),
        prisma.goldTrade.findMany({
          where: whereClause,
          include: {
            seller: { select: { discordId: true, username: true, displayName: true } },
            buyer: { select: { discordId: true, username: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      res.json({
        success: true,
        trades: trades.map((t) => ({
          id: t.id,
          tradeRef: t.tradeRef,
          seller: t.seller?.displayName || t.seller?.username || t.sellerId,
          buyer: t.buyer?.displayName || t.buyer?.username || t.buyerId,
          gameSlug: t.gameSlug,
          region: t.region,
          realm: t.realm,
          faction: t.faction,
          goldQuantity: t.goldQuantity,
          agreedValuationUsdCents: t.agreedValuationUsdCents,
          valuationFormatted: `$${(t.agreedValuationUsdCents / 100).toFixed(2)}`,
          settlementMethod: t.settlementMethod,
          tradeStatus: t.tradeStatus,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: 'TRADE_FETCH_FAILED', message: err.message || 'Failed to fetch trades' });
    }
  }
);

adminPortalRouter.get(
  '/admin/exchange/offers',
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const offers = await prisma.exchangerFeeOffer.findMany({
        include: {
          exchanger: { select: { discordId: true, username: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        offers: offers.map((o) => ({
          id: o.id,
          offerRef: o.offerRef,
          exchanger: o.exchanger?.displayName || o.exchanger?.username || o.exchangerId,
          serviceType: o.serviceType,
          settlementCurrency: o.settlementCurrency,
          commissionPercentage: o.commissionPercentage,
          commissionFormatted: `${(o.commissionPercentage * 100).toFixed(2)}%`,
          minAmount: o.minAmount,
          maxAmount: o.maxAmount,
          status: o.status,
          createdAt: o.createdAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'OFFERS_FETCH_FAILED', message: err.message || 'Failed to fetch offers' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. PLATFORM AUDIT LOG ACTIVITY
// ─────────────────────────────────────────────────────────────────────────────

adminPortalRouter.get(
  '/admin/audit-logs',
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
      const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
      const entityType = typeof req.query.entityType === 'string' ? req.query.entityType.trim() : '';
      const actorId = typeof req.query.actorId === 'string' ? req.query.actorId.trim() : '';

      const whereClause: any = {};
      if (action) whereClause.action = { contains: action };
      if (entityType) whereClause.entityType = entityType;
      if (actorId) whereClause.actorId = actorId;

      const [total, logs] = await Promise.all([
        prisma.auditLog.count({ where: whereClause }),
        prisma.auditLog.findMany({
          where: whereClause,
          include: {
            actor: { select: { discordId: true, username: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      res.json({
        success: true,
        logs: logs.map((l) => ({
          id: l.id,
          actor: l.actor?.displayName || l.actor?.username || l.actorId,
          actorId: l.actorId,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          reason: l.reason,
          isSuccess: l.isSuccess,
          createdAt: l.createdAt,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: 'AUDIT_FETCH_FAILED', message: err.message || 'Failed to fetch audit logs' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. ROLE & PERMISSION MATRIX VISIBILITY
// ─────────────────────────────────────────────────────────────────────────────

adminPortalRouter.get(
  '/admin/roles-matrix',
  requireAuth,
  requireAdminPortalAccess,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({
        success: true,
        roles: Object.keys(ROLE_PERMISSIONS) as SystemRoleKey[],
        permissionsMatrix: ROLE_PERMISSIONS,
        allPermissions: Object.values(Permission),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'MATRIX_FETCH_FAILED', message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. ADMIN ASSISTED KYC & DIRECT REQUEST DM ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

adminPortalRouter.get(
  ['/admin/kyc/users/:discordId', '/api/admin/kyc/users/:discordId'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordId } = req.params;
      if (!discordId) {
        res.status(400).json({ error: 'USER_ID_REQUIRED' });
        return;
      }
      const kycStatus = await getUserKycStatus(discordId);
      res.json({
        success: true,
        ...kycStatus,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'KYC_FETCH_FAILED', message: err.message });
    }
  }
);

adminPortalRouter.post(
  ['/admin/kyc/users/:discordId/assist', '/api/admin/kyc/users/:discordId/assist'],
  requireAuth,
  requireAdminPortalAccess,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordId } = req.params;
      const actor = (req as AuthenticatedRequest).user;
      if (!actor || !actor.discordId) {
        res.status(401).json({ error: 'UNAUTHORIZED' });
        return;
      }

      const {
        legalName,
        country,
        idType,
        idNumber,
        phoneNumber,
        vpnConfirmed,
        adminNotes,
        identityDocData,
        identityDocName,
        selfieDocData,
        selfieDocName,
        markAsVerified,
      } = req.body;

      const result = await assistUserKyc({
        targetUserId: discordId,
        actorId: actor.discordId,
        legalName,
        country,
        idType,
        idNumber,
        phoneNumber,
        vpnConfirmed: Boolean(vpnConfirmed),
        adminNotes,
        identityDocData,
        identityDocName,
        selfieDocData,
        selfieDocName,
        markAsVerified: Boolean(markAsVerified),
      });

      res.json({
        success: true,
        result,
        message: markAsVerified ? 'KYC verified and updated successfully.' : 'Assisted KYC data updated successfully.',
      });
    } catch (err: any) {
      res.status(500).json({ error: 'ASSISTED_KYC_FAILED', message: err.message });
    }
  }
);

adminPortalRouter.post(
  ['/admin/users/:discordId/send-kyc-dm', '/api/admin/users/:discordId/send-kyc-dm'],
  requireAuth,
  requireAdminPortalAccess,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordId } = req.params;
      const actor = (req as AuthenticatedRequest).user;
      const { reason } = req.body;

      const dmResult = await sendKycRequestDm(discordId, {
        requestedBy: actor?.displayName || actor?.username || 'G4X Staff',
        reason,
      });

      res.json({
        success: true,
        ...dmResult,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'SEND_KYC_DM_FAILED', message: err.message });
    }
  }
);

