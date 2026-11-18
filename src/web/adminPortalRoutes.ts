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
import { requireOwnerPortalAccess } from './ownerPortalRoutes';
import { G4XBoostReleaseStage } from '../services/financeV2/financeV2Types';
import { publishOrRefreshOrderCard, getGlobalDiscordClient } from '../services/orderDiscordService';

export const adminPortalRouter = Router();

/**
 * Ensures caller holds active Admin or Owner role.
 */
export function requireAdminOrOwner(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const user = (req as AuthenticatedRequest).user;
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication session required' });
    return;
  }

  const userRoles = (user.userRoles || []).map((r) => String(r.roleKey).toLowerCase());
  const isAuthorized = userRoles.includes('admin') || userRoles.includes('owner');

  if (!isAuthorized) {
    res.status(403).json({
      error: 'ADMIN_OR_OWNER_REQUIRED',
      message: 'Access restricted exclusively to Administrator or Owner personnel.',
    });
    return;
  }

  next();
}

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
  [
    '/owner/finance/overview',
    '/api/owner/finance/overview',
    '/admin/finance/overview',
    '/api/admin/finance/overview',
  ],
  requireAuth,
  requireOwnerPortalAccess,
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

      // Fetch authoritative dollar rate from SystemFinancialConfig
      const rateConfig = await prisma.systemFinancialConfig.findUnique({
        where: { key: 'admin_usd_irt_rate' },
      });
      const dollarRate = rateConfig?.value ? parseFloat(rateConfig.value) : 90000;

      const totals = {
        dollarRate,
        dollarRateFormatted: `${dollarRate.toLocaleString('en-US')} Toman`,
        grossVolumeMinor: totalGrossVolumeMinor,
        grossVolumeUsd: formatCentsToUsd(totalGrossVolumeMinor),
        grossVolumeToman: `${Math.round((totalGrossVolumeMinor / 100) * dollarRate).toLocaleString('en-US')} Toman`,
        platformFeesMinor: totalPlatformFeesMinor,
        platformFeesUsd: formatCentsToUsd(totalPlatformFeesMinor),
        netPlatformProfitMinor: totalNetPlatformProfitMinor,
        netPlatformProfitUsd: formatCentsToUsd(totalNetPlatformProfitMinor),
        netPlatformProfitToman: `${Math.round((totalNetPlatformProfitMinor / 100) * dollarRate).toLocaleString('en-US')} Toman`,
        boosterPoolMinor: totalBoosterPoolMinor,
        boosterPoolUsd: formatCentsToUsd(totalBoosterPoolMinor),
        boosterPoolToman: `${Math.round((totalBoosterPoolMinor / 100) * dollarRate).toLocaleString('en-US')} Toman`,
        activeEscrowMinor,
        activeEscrowUsd: formatCentsToUsd(activeEscrowMinor),
        activeEscrowToman: `${Math.round((activeEscrowMinor / 100) * dollarRate).toLocaleString('en-US')} Toman`,
        completedVolumeMinor,
        completedVolumeUsd: formatCentsToUsd(completedVolumeMinor),
        completedVolumeToman: `${Math.round((completedVolumeMinor / 100) * dollarRate).toLocaleString('en-US')} Toman`,
        boosterWalletLiabilityMinor,
        boosterWalletLiabilityUsd: formatCentsToUsd(boosterWalletLiabilityMinor),
        boosterWalletLiabilityToman: `${Math.round((boosterWalletLiabilityMinor / 100) * dollarRate).toLocaleString('en-US')} Toman`,
        pendingWithdrawalsCount,
        pendingWithdrawalsMinor,
        pendingWithdrawalsUsd: formatCentsToUsd(pendingWithdrawalsMinor),
        pendingWithdrawalsToman: `${Math.round((pendingWithdrawalsMinor / 100) * dollarRate).toLocaleString('en-US')} Toman`,
        paidWithdrawalsCount,
        paidWithdrawalsMinor,
        paidWithdrawalsUsd: formatCentsToUsd(paidWithdrawalsMinor),
        netLiquidReserveMinor,
        netLiquidReserveUsd: formatCentsToUsd(netLiquidReserveMinor),
        netLiquidReserveToman: `${Math.round((netLiquidReserveMinor / 100) * dollarRate).toLocaleString('en-US')} Toman`,
      };

      res.json({
        success: true,
        totals,
        byPlatform,
        dollarRate: {
          rate: dollarRate,
          formatted: `${dollarRate.toLocaleString('en-US')} Toman`,
          updatedAt: rateConfig?.updatedAt ? rateConfig.updatedAt.toISOString() : undefined,
          source: 'SystemFinancialConfig (admin_usd_irt_rate)',
        },
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

// ─────────────────────────────────────────────────────────────────────────────
// 12. COMPREHENSIVE AGGREGATED USER PROFILE & DETAILS INSPECTION API
// ─────────────────────────────────────────────────────────────────────────────

adminPortalRouter.get(
  ['/admin/users/:discordId/details', '/api/admin/users/:discordId/details'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordId } = req.params;
      if (!discordId) {
        res.status(400).json({ error: 'INVALID_REQUEST', message: 'Discord ID parameter required' });
        return;
      }

      // 1. Fetch Core User and Roles
      const user = await prisma.user.findUnique({
        where: { discordId },
        include: {
          userRoles: {
            orderBy: { grantedAt: 'desc' },
          },
        },
      });

      if (!user) {
        res.status(404).json({ error: 'USER_NOT_FOUND', message: `User with Discord ID '${discordId}' not found.` });
        return;
      }

      // 2. Parallel Aggregate Data Fetching
      const [
        gameApprovals,
        wowCharacters,
        kycStatus,
        pilotVerifications,
        walletV2,
        legacyWallet,
        payoutPreference,
        v2CreditsAgg,
        v1CreditsAgg,
        paidWithdrawalsAgg,
        completedAssignmentsCount,
        activeAssignmentsCount,
        assignedOrdersRaw,
        reservationsRaw,
        createdOrdersRaw,
        presignsRaw,
        ledgerV2Raw,
        ledgerV1Raw,
        withdrawalsRaw,
        auditLogsRaw,
      ] = await Promise.all([
        // Game Approvals
        prisma.userGameApproval.findMany({
          where: { userId: discordId },
          include: {
            game: { select: { slug: true, displayName: true } },
            service: { select: { id: true, serviceKey: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),

        // WoW Characters
        prisma.wowCharacter.findMany({
          where: { userId: discordId },
          orderBy: [{ isMain: 'desc' }, { mythicScore: 'desc' }],
        }),

        // KYC Status & Documents (via existing helper)
        getUserKycStatus(discordId).catch(() => null),

        // Pilot Verifications
        prisma.pilotVerification.findMany({
          where: { userId: discordId },
          include: {
            game: { select: { slug: true, displayName: true } },
          },
          orderBy: { submittedAt: 'desc' },
        }),

        // Wallet V2
        prisma.walletV2.findUnique({
          where: { userId: discordId },
        }),

        // Legacy Wallet
        prisma.wallet.findUnique({
          where: { userId: discordId },
        }),

        // Payout Preference
        prisma.userPayoutPreference.findUnique({
          where: { userId: discordId },
        }),

        // Lifetime Earnings (V2)
        prisma.ledgerEntryV2.aggregate({
          where: {
            userId: discordId,
            direction: 'CREDIT',
            entryType: { in: ['EARNING_CONFIRMED', 'AVAILABLE_RELEASE', 'EARNING_PENDING'] },
          },
          _sum: { amountCents: true },
        }),

        // Lifetime Earnings (V1)
        prisma.ledgerTransaction.aggregate({
          where: {
            userId: discordId,
            entryType: { in: ['credit', 'escrow_release'] },
            status: { not: 'reversed' },
          },
          _sum: { amountMinor: true },
        }),

        // Total Withdrawn
        prisma.boosterWithdrawalRequest.aggregate({
          where: {
            boosterId: discordId,
            status: { in: ['PAID', 'COMPLETED', 'SETTLED'] },
          },
          _sum: { requestedUsdCents: true },
        }),

        // Completed Orders Count
        prisma.orderAssignment.count({
          where: {
            userId: discordId,
            OR: [
              { status: 'completed' },
              { order: { status: 'completed' } },
            ],
          },
        }),

        // Active Assigned Orders Count
        prisma.orderAssignment.count({
          where: {
            userId: discordId,
            status: { in: ['assigned', 'accepted'] },
            order: { status: { in: ['open_presign', 'presign_closed', 'assigned', 'in_progress'] } },
          },
        }),

        // Assigned Orders (Boosts)
        prisma.orderAssignment.findMany({
          where: { userId: discordId },
          include: {
            order: {
              select: {
                id: true,
                orderRef: true,
                externalOrderId: true,
                title: true,
                orderName: true,
                sourceWebsite: true,
                status: true,
                boosterPoolMinor: true,
                grossAmountMinor: true,
                createdAt: true,
                completedAt: true,
              },
            },
          },
          orderBy: { assignedAt: 'desc' },
          take: 50,
        }),

        // Active / Recent Reservations (Boosts via Reservations)
        prisma.boosterReservation.findMany({
          where: { userId: discordId },
          include: {
            order: {
              select: {
                id: true,
                orderRef: true,
                externalOrderId: true,
                title: true,
                orderName: true,
                sourceWebsite: true,
                status: true,
                boosterPoolMinor: true,
                grossAmountMinor: true,
                createdAt: true,
                completedAt: true,
              },
            },
          },
          orderBy: { reservedAt: 'desc' },
          take: 50,
        }),

        // Created Orders (Client / Advertiser)
        prisma.order.findMany({
          where: {
            OR: [
              { creatorId: discordId },
              { advertiserId: discordId },
              { customerId: discordId },
            ],
          },
          select: {
            id: true,
            orderRef: true,
            externalOrderId: true,
            title: true,
            orderName: true,
            sourceWebsite: true,
            status: true,
            grossAmountMinor: true,
            createdAt: true,
            completedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),

        // Order Pre-Signs
        prisma.orderPresign.findMany({
          where: { userId: discordId },
          include: {
            order: {
              select: {
                id: true,
                orderRef: true,
                title: true,
                orderName: true,
                status: true,
                sourceWebsite: true,
              },
            },
            character: {
              select: {
                characterName: true,
                realm: true,
              },
            },
          },
          orderBy: { registeredAt: 'desc' },
          take: 50,
        }),

        // Ledger V2 Entries
        prisma.ledgerEntryV2.findMany({
          where: { userId: discordId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),

        // Ledger V1 Entries
        prisma.ledgerTransaction.findMany({
          where: { userId: discordId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),

        // Withdrawal Requests
        prisma.boosterWithdrawalRequest.findMany({
          where: { boosterId: discordId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),

        // Audit Logs (targeting this user or acted by this user)
        prisma.auditLog.findMany({
          where: {
            OR: [
              { entityId: discordId },
              { actorId: discordId },
            ],
          },
          include: {
            actor: {
              select: {
                discordId: true,
                username: true,
                displayName: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
      ]);

      // 4. Combine Assigned Orders (both direct assignments and booster reservations)
      const seenOrderIds = new Set<number>();
      const assignedOrders: any[] = [];

      for (const a of assignedOrdersRaw) {
        if (!a.order) continue;
        seenOrderIds.add(a.order.id);
        const poolMinor = a.order.boosterPoolMinor || 0;
        assignedOrders.push({
          assignmentId: String(a.id),
          orderId: String(a.order.id),
          orderRef: a.order.orderRef,
          externalOrderId: a.order.externalOrderId || null,
          title: a.order.title || a.order.orderName || a.order.orderRef,
          platform: a.order.sourceWebsite || 'direct',
          status: a.order.status,
          assignmentStatus: a.status,
          assignedRole: a.assignedRole || 'Booster',
          boosterPayoutShare: poolMinor / 100,
          boosterPayoutShareFormatted: formatCentsToUsd(poolMinor),
          grossAmountUsd: (a.order.grossAmountMinor || 0) / 100,
          assignedAt: a.assignedAt.toISOString(),
          completedAt: a.order.completedAt ? a.order.completedAt.toISOString() : null,
        });
      }

      for (const r of reservationsRaw) {
        if (!r.order || seenOrderIds.has(r.order.id)) continue;
        seenOrderIds.add(r.order.id);
        const poolMinor = r.order.boosterPoolMinor || 0;
        assignedOrders.push({
          assignmentId: `res_${r.id}`,
          orderId: String(r.order.id),
          orderRef: r.order.orderRef,
          externalOrderId: r.order.externalOrderId || null,
          title: r.order.title || r.order.orderName || r.order.orderRef,
          platform: r.order.sourceWebsite || 'direct',
          status: r.order.status,
          assignmentStatus: r.status,
          assignedRole: 'Booster (Reserved)',
          boosterPayoutShare: poolMinor / 100,
          boosterPayoutShareFormatted: formatCentsToUsd(poolMinor),
          grossAmountUsd: (r.order.grossAmountMinor || 0) / 100,
          assignedAt: r.reservedAt.toISOString(),
          completedAt: r.order.completedAt ? r.order.completedAt.toISOString() : null,
        });
      }

      const activeAssignedCount = Math.max(
        activeAssignmentsCount,
        assignedOrders.filter((o) =>
          ['assigned', 'accepted', 'active'].includes(String(o.assignmentStatus).toLowerCase()) &&
          ['open_presign', 'presign_closed', 'assigned', 'in_progress'].includes(String(o.status).toLowerCase())
        ).length
      );

      // 3. Format Financials
      const availableCents = walletV2?.availableCents ?? (legacyWallet?.balanceUsd ?? 0);
      const reservedCents = walletV2?.reservedCents ?? (legacyWallet?.escrowUsd ?? 0);
      const pendingEarningsCents = walletV2?.pendingEarningsCents ?? 0;
      const confirmedEarningsCents = walletV2?.confirmedEarningsCents ?? 0;
      const paidCents = walletV2?.paidCents ?? 0;

      const lifetimeEarningsCents = Math.max(
        v2CreditsAgg._sum.amountCents || 0,
        v1CreditsAgg._sum.amountMinor || 0
      );
      const totalWithdrawnCents = paidWithdrawalsAgg._sum.requestedUsdCents || 0;

      const financialSummary = {
        availableBalance: availableCents / 100,
        availableBalanceFormatted: formatCentsToUsd(availableCents),
        pendingEscrowBalance: (reservedCents + pendingEarningsCents) / 100,
        pendingEscrowBalanceFormatted: formatCentsToUsd(reservedCents + pendingEarningsCents),
        reservedBalance: reservedCents / 100,
        reservedBalanceFormatted: formatCentsToUsd(reservedCents),
        totalLifetimeEarnings: lifetimeEarningsCents / 100,
        totalLifetimeEarningsFormatted: formatCentsToUsd(lifetimeEarningsCents),
        totalWithdrawn: totalWithdrawnCents / 100,
        totalWithdrawnFormatted: formatCentsToUsd(totalWithdrawnCents),
        totalOrdersCompleted: completedAssignmentsCount,
        activeAssignedOrdersCount: activeAssignedCount,
        currency: 'USD',
        payoutAddress: payoutPreference?.cryptoAddress || payoutPreference?.bankIban || null,
        payoutNetwork: payoutPreference?.cryptoNetwork || (payoutPreference?.bankIban ? 'Shetab / Bank IBAN' : null),
        bankAccountHolder: payoutPreference?.bankAccountHolder || null,
        bankIban: payoutPreference?.bankIban || null,
        cryptoAddress: payoutPreference?.cryptoAddress || null,
        cryptoNetwork: payoutPreference?.cryptoNetwork || null,
      };

      // 5. Format Created Orders
      const createdOrders = createdOrdersRaw.map((o) => ({
        orderId: String(o.id),
        orderRef: o.orderRef,
        externalOrderId: o.externalOrderId || null,
        title: o.title || o.orderName || o.orderRef,
        platform: o.sourceWebsite || 'direct',
        status: o.status,
        grossAmountUsd: (o.grossAmountMinor || 0) / 100,
        grossAmountFormatted: formatCentsToUsd(o.grossAmountMinor || 0),
        createdAt: o.createdAt.toISOString(),
        completedAt: o.completedAt ? o.completedAt.toISOString() : null,
      }));

      // 6. Format Pre-Signs
      const preSigns = presignsRaw.map((p) => ({
        id: String(p.id),
        orderId: String(p.orderId),
        orderRef: p.order.orderRef,
        orderTitle: p.order.title || p.order.orderName || p.order.orderRef,
        orderStatus: p.order.status,
        platform: p.order.sourceWebsite || 'direct',
        claimType: p.claimType,
        registeredRole: p.registeredRole,
        hasKey: p.hasKey,
        keyLevel: p.keyLevel,
        characterName: p.character ? `${p.character.characterName} (${p.character.realm})` : null,
        status: p.status,
        registeredAt: p.registeredAt.toISOString(),
      }));

      // 7. Format Ledger Transactions
      const ledgerTransactions = (ledgerV2Raw.length > 0 ? ledgerV2Raw : ledgerV1Raw).map((entry: any) => {
        const isV2 = 'entryType' in entry && 'amountCents' in entry;
        const amountCents = isV2 ? Math.abs(entry.amountCents) : Math.abs(entry.amountMinor);
        const direction = isV2 ? entry.direction : (entry.entryType === 'debit' ? 'DEBIT' : 'CREDIT');
        return {
          id: entry.id,
          entryRef: isV2 ? entry.entryRef : entry.transactionRef,
          type: entry.entryType,
          direction,
          amount: amountCents / 100,
          amountFormatted: `${direction === 'DEBIT' ? '-' : '+'}$${(amountCents / 100).toFixed(2)}`,
          balanceAfter: isV2 && entry.balanceAfterAvailableCents != null ? entry.balanceAfterAvailableCents / 100 : null,
          orderId: entry.orderId || null,
          note: (isV2 ? entry.description : null) || null,
          createdAt: entry.createdAt.toISOString(),
        };
      });

      // 8. Format Withdrawals
      const withdrawals = withdrawalsRaw.map((w) => ({
        id: w.id,
        withdrawalRef: w.withdrawalRef,
        amount: w.requestedUsdCents / 100,
        amountFormatted: formatCentsToUsd(w.requestedUsdCents),
        netAmount: w.netUsdCents / 100,
        netAmountFormatted: formatCentsToUsd(w.netUsdCents),
        fee: w.fixedFeeUsdCents / 100,
        payoutMethod: w.payoutMethod,
        walletAddress: w.destinationAddress,
        accountHolder: w.destinationAccountHolder,
        status: w.status,
        txHash: w.externalTxHash,
        receiptRef: w.bankReceiptRef,
        createdAt: w.createdAt.toISOString(),
        processedAt: w.processedAt ? w.processedAt.toISOString() : null,
      }));

      // 9. Format Audit Logs
      const auditLogs = auditLogsRaw.map((l) => ({
        id: l.id,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        actorDiscordId: l.actorId,
        actorUsername: l.actor ? (l.actor.displayName || l.actor.username) : (l.actorId || 'System'),
        reason: l.reason,
        isSuccess: l.isSuccess,
        details: l.newValues || l.previousValues || null,
        createdAt: l.createdAt.toISOString(),
      }));

      // 10. Construct Final Aggregated Response
      const userProfile = {
        id: user.discordId,
        discordId: user.discordId,
        username: user.username,
        displayName: user.displayName || user.username,
        avatarUrl: null,
        status: user.isActive ? 'Active' : 'Suspended',
        isActive: user.isActive,
        advertiserRank: user.advertiserRank,
        phoneNumber: user.phoneNumber,
        telegramUsername: user.telegramUsername,
        whatsappNumber: user.whatsappNumber,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      };

      const userRoles = user.userRoles.map((r) => ({
        roleKey: r.roleKey,
        grantedAt: r.grantedAt.toISOString(),
        grantedBy: r.grantedBy,
      }));

      const formattedGameApprovals = gameApprovals.map((ga) => ({
        id: String(ga.id),
        gameSlug: ga.gameSlug,
        gameName: ga.game.displayName,
        serviceId: ga.serviceId ? String(ga.serviceId) : null,
        serviceName: ga.service?.displayName || null,
        approvalType: ga.approvalType,
        status: ga.status,
        reviewNote: ga.reviewNote,
        reviewedAt: ga.reviewedAt ? ga.reviewedAt.toISOString() : null,
        reviewedBy: ga.reviewedBy,
        createdAt: ga.createdAt.toISOString(),
      }));

      const formattedWowCharacters = wowCharacters.map((c) => ({
        id: String(c.id),
        characterName: c.characterName,
        name: c.characterName,
        realm: c.realm,
        region: c.region,
        characterClass: c.characterClass || 'Unknown',
        class: c.characterClass || 'Unknown',
        activeSpec: c.activeSpec || '',
        spec: c.activeSpec || '',
        itemLevel: c.itemLevel || 0,
        mythicScore: c.mythicScore || 0,
        activeRole: c.activeRole || 'DPS',
        role: c.activeRole || 'DPS',
        faction: c.faction || 'Neutral',
        isMain: c.isMain,
        isActive: c.isActive,
        syncStatus: c.syncStatus,
        lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
      }));

      const formattedKyc = {
        status: kycStatus?.status || 'none',
        isVerified: kycStatus?.isVerified || false,
        verifiedAt: kycStatus?.verifiedAt ? new Date(kycStatus.verifiedAt).toISOString() : null,
        legalName: kycStatus?.profileData?.legalName || null,
        country: kycStatus?.profileData?.country || null,
        idNumber: kycStatus?.profileData?.idNumber ? '••••' + kycStatus.profileData.idNumber.slice(-4) : null,
        contactInfo: kycStatus?.profileData?.phoneNumber || user.phoneNumber || null,
        vpnConfirmed: Boolean(kycStatus?.profileData?.vpnConfirmed),
        adminNotes: kycStatus?.profileData?.adminNotes || null,
        documents: {
          identity: Boolean(kycStatus?.documents?.identity),
          passport: Boolean(kycStatus?.documents?.passport),
          selfie: Boolean(kycStatus?.documents?.selfie),
          totalUploaded: [kycStatus?.documents?.identity, kycStatus?.documents?.passport, kycStatus?.documents?.selfie].filter(Boolean).length,
        },
        pilotVerifications: pilotVerifications.map((pv) => ({
          id: String(pv.id),
          gameSlug: pv.gameSlug,
          gameName: pv.game.displayName,
          status: pv.status,
          submittedAt: pv.submittedAt.toISOString(),
          reviewedAt: pv.reviewedAt ? pv.reviewedAt.toISOString() : null,
          reviewedBy: pv.reviewedBy,
          reviewNote: pv.reviewNote,
          hasIdentityDoc: Boolean(pv.identityDocumentRef),
          hasPassportDoc: Boolean(pv.passportDocumentRef),
          hasSelfieDoc: Boolean(pv.selfieDocumentRef),
        })),
      };

      const ordersPayload = {
        assignedOrders,
        createdOrders,
        preSigns,
        totalAssigned: assignedOrders.length,
        totalCreated: createdOrders.length,
        totalPreSigns: preSigns.length,
      };

      const ledgerPayload = {
        transactions: ledgerTransactions,
        totalTransactions: ledgerTransactions.length,
      };

      const withdrawalsPayload = {
        requests: withdrawals,
        totalRequests: withdrawals.length,
      };

      const userPayload = {
        profile: userProfile,
        roles: userRoles,
        gameApprovals: formattedGameApprovals,
        wowCharacters: formattedWowCharacters,
        kyc: formattedKyc,
        financialSummary,
        orders: ordersPayload,
        ledger: ledgerPayload,
        withdrawals: withdrawalsPayload,
        auditTrail: auditLogs,
        // Flat backward compatibility
        ...userProfile,
      };

      res.json({
        success: true,
        user: userPayload,
        profile: userProfile,
        roles: userRoles,
        gameApprovals: formattedGameApprovals,
        wowCharacters: formattedWowCharacters,
        kyc: formattedKyc,
        financialSummary,
        orders: ordersPayload,
        ledger: ledgerPayload,
        withdrawals: withdrawalsPayload,
        financialActivity: {
          ledgerTransactions,
          withdrawals,
          totalLedgerEntries: ledgerTransactions.length,
          totalWithdrawals: withdrawals.length,
        },
        auditLogs,
        auditTrail: auditLogs,
      });
    } catch (err: any) {
      console.error('[AdminUserDetails] Failed to aggregate profile:', err);
      res.status(500).json({ error: 'FAILED_TO_FETCH_USER_DETAILS', message: err.message || 'Internal server error' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 11. ADMIN & OWNER FULL ORDER EDIT ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/orders/:id/edit-data
 * Returns the target order with all editable fields along with active games and services.
 */
adminPortalRouter.get(
  ['/api/admin/orders/:id/edit-data', '/admin/orders/:id/edit-data'],
  requireAuth,
  requireAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    const orderId = Number(req.params.id);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'INVALID_ORDER_ID', message: 'Valid positive order ID required.' });
      return;
    }

    try {
      const [order, games, services] = await Promise.all([
        prisma.order.findUnique({
          where: { id: orderId },
          include: {
            game: { select: { slug: true, displayName: true } },
            service: { select: { id: true, displayName: true, serviceKey: true } },
            creator: { select: { discordId: true, username: true, displayName: true } },
            advertiser: { select: { discordId: true, username: true, displayName: true } },
            customer: { select: { discordId: true, username: true, displayName: true } },
          },
        }),
        prisma.game.findMany({
          where: { isActive: true },
          select: { slug: true, displayName: true },
          orderBy: { displayName: 'asc' },
        }),
        prisma.gameService.findMany({
          select: { id: true, gameSlug: true, displayName: true, serviceKey: true, serviceMode: true },
          orderBy: { displayName: 'asc' },
        }),
      ]);

      if (!order) {
        res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'Order not found.' });
        return;
      }

      res.json({
        success: true,
        order: {
          id: order.id,
          orderRef: order.orderRef,
          title: order.title || order.orderName || '',
          orderName: order.orderName || order.title || '',
          gameSlug: order.gameSlug,
          serviceId: order.serviceId,
          orderType: order.orderType,
          orderMode: order.orderMode,
          boostModel: order.boostModel || '',
          vpnRequirement: order.vpnRequirement || '',
          quantity: order.quantity || 1,
          notes: order.notes || '',
          sourceType: order.sourceType,
          sourceWebsite: order.sourceWebsite || 'direct',
          externalOrderId: order.externalOrderId || '',
          currency: order.currency,
          grossAmountUsd: (order.grossAmountMinor / 100).toFixed(2),
          grossAmountMinor: order.grossAmountMinor,
          platformFeeUsd: (order.platformFeeMinor / 100).toFixed(2),
          platformFeeMinor: order.platformFeeMinor,
          advertiserFeeUsd: (order.advertiserFeeMinor / 100).toFixed(2),
          advertiserFeeMinor: order.advertiserFeeMinor,
          boosterPoolUsd: (order.boosterPoolMinor / 100).toFixed(2),
          boosterPoolMinor: order.boosterPoolMinor,
          status: order.status,
          paymentStatus: order.paymentStatus,
          advertiserId: order.advertiserId || '',
          creatorId: order.creatorId || '',
          customerId: order.customerId || '',
          discordChannelId: order.discordChannelId || '',
          discordMessageId: order.discordMessageId || '',
          executionChannelId: order.executionChannelId || '',
          reviewChannelId: order.reviewChannelId || '',
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          completedAt: order.completedAt ? order.completedAt.toISOString() : null,
          creator: order.creator,
          advertiser: order.advertiser,
          customer: order.customer,
        },
        games,
        services,
      });
    } catch (err: any) {
      console.error('[AdminOrderEditData] Error fetching order edit data:', err);
      res.status(500).json({ error: 'FAILED_TO_FETCH_EDIT_DATA', message: err.message || 'Internal server error' });
    }
  }
);

/**
 * Full modification of order fields by Administrator or Owner with strict financial safety & audit logging.
 */
const handleAdminFullOrderUpdate = async (req: Request, res: Response): Promise<void> => {
  const orderId = Number(req.params.id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: 'INVALID_ORDER_ID', message: 'Valid positive order ID required.' });
    return;
  }

  const actor = (req as AuthenticatedRequest).user;
  const {
    title,
    orderName,
    gameSlug,
    serviceId,
    orderType,
    orderMode,
    boostModel,
    vpnRequirement,
    quantity,
    notes,
    externalOrderId,
    sourceType,
    sourceWebsite,
    currency,
    grossAmountUsd,
    grossAmountMinor: inputGrossAmountMinor,
    boosterPoolUsd,
    boosterPoolMinor: inputBoosterPoolMinor,
    platformFeeUsd,
    platformFeeMinor: inputPlatformFeeMinor,
    status: targetStatus,
    paymentStatus: targetPaymentStatus,
    advertiserId,
    customerId,
    creatorId,
    executionChannelId,
    discordChannelId,
    reason,
  } = req.body;

  try {
    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        game: true,
        service: true,
      },
    });

    if (!existing) {
      res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'Target order not found.' });
      return;
    }

    // 1. Process Financials
    let newGrossMinor = existing.grossAmountMinor;
    if (grossAmountUsd !== undefined && grossAmountUsd !== null && grossAmountUsd !== '') {
      newGrossMinor = Math.round(Number(grossAmountUsd) * 100);
    } else if (inputGrossAmountMinor !== undefined && inputGrossAmountMinor !== null) {
      newGrossMinor = Number(inputGrossAmountMinor);
    }

    let newBoosterPoolMinor = existing.boosterPoolMinor;
    if (boosterPoolUsd !== undefined && boosterPoolUsd !== null && boosterPoolUsd !== '') {
      newBoosterPoolMinor = Math.round(Number(boosterPoolUsd) * 100);
    } else if (inputBoosterPoolMinor !== undefined && inputBoosterPoolMinor !== null) {
      newBoosterPoolMinor = Number(inputBoosterPoolMinor);
    }

    if (isNaN(newGrossMinor) || newGrossMinor < 0) {
      res.status(400).json({ error: 'INVALID_GROSS_AMOUNT', message: 'Gross amount must be a non-negative number.' });
      return;
    }

    if (isNaN(newBoosterPoolMinor) || newBoosterPoolMinor < 0) {
      res.status(400).json({ error: 'INVALID_BOOSTER_POOL', message: 'Booster reward pool must be a non-negative number.' });
      return;
    }

    if (newGrossMinor > 0 && newBoosterPoolMinor > newGrossMinor) {
      res.status(400).json({
        error: 'INVALID_FINANCIAL_SPLIT',
        message: `Booster pool ($${(newBoosterPoolMinor / 100).toFixed(2)}) cannot exceed total order price ($${(newGrossMinor / 100).toFixed(2)}).`,
      });
      return;
    }

    let newPlatformFeeMinor = Math.max(0, newGrossMinor - newBoosterPoolMinor);
    if (platformFeeUsd !== undefined && platformFeeUsd !== null && platformFeeUsd !== '') {
      newPlatformFeeMinor = Math.round(Number(platformFeeUsd) * 100);
    } else if (inputPlatformFeeMinor !== undefined && inputPlatformFeeMinor !== null) {
      newPlatformFeeMinor = Number(inputPlatformFeeMinor);
    }

    // 2. Validate Game & Service if changed
    const targetGameSlug = gameSlug ? String(gameSlug).trim() : existing.gameSlug;
    let targetServiceId = existing.serviceId;
    if (serviceId) {
      const sId = Number(serviceId);
      if (Number.isSafeInteger(sId) && sId > 0) {
        targetServiceId = sId;
      }
    }

    // 3. Prepare Update Payload
    const resolvedTitle = title !== undefined ? (title ? String(title).trim() : null) : existing.title;
    const resolvedOrderName = orderName !== undefined ? (orderName ? String(orderName).trim() : null) : (resolvedTitle || existing.orderName);

    const updateData: any = {
      title: resolvedTitle,
      orderName: resolvedOrderName,
      gameSlug: targetGameSlug,
      serviceId: targetServiceId,
      grossAmountMinor: newGrossMinor,
      boosterPoolMinor: newBoosterPoolMinor,
      platformFeeMinor: newPlatformFeeMinor,
      currency: currency ? String(currency).toUpperCase().trim() : existing.currency,
      quantity: quantity !== undefined ? Math.max(1, Number(quantity) || 1) : existing.quantity,
      orderType: orderType ? String(orderType).trim() : existing.orderType,
      orderMode: orderMode ? String(orderMode).trim() : existing.orderMode,
      boostModel: boostModel !== undefined ? (boostModel ? String(boostModel).trim() : null) : existing.boostModel,
      vpnRequirement: vpnRequirement !== undefined ? (vpnRequirement ? String(vpnRequirement).trim() : null) : existing.vpnRequirement,
      notes: notes !== undefined ? (notes ? String(notes).trim() : null) : existing.notes,
      externalOrderId: externalOrderId !== undefined ? (externalOrderId ? String(externalOrderId).trim() : null) : existing.externalOrderId,
      sourceType: sourceType ? String(sourceType).trim() : existing.sourceType,
      sourceWebsite: sourceWebsite !== undefined ? (sourceWebsite ? String(sourceWebsite).trim().toLowerCase() : null) : existing.sourceWebsite,
      updatedAt: new Date(),
    };

    if (advertiserId !== undefined) {
      updateData.advertiserId = advertiserId ? String(advertiserId).trim() : null;
    }
    if (customerId !== undefined) {
      updateData.customerId = customerId ? String(customerId).trim() : null;
    }
    if (creatorId !== undefined) {
      updateData.creatorId = creatorId ? String(creatorId).trim() : null;
    }
    if (executionChannelId !== undefined) {
      updateData.executionChannelId = executionChannelId ? String(executionChannelId).trim() : null;
    }
    if (discordChannelId !== undefined) {
      updateData.discordChannelId = discordChannelId ? String(discordChannelId).trim() : null;
    }

    // 4. Handle Status Transitions
    const nextStatus = targetStatus ? String(targetStatus).trim() : existing.status;
    const nextPaymentStatus = targetPaymentStatus ? String(targetPaymentStatus).trim() : existing.paymentStatus;
    updateData.status = nextStatus;
    updateData.paymentStatus = nextPaymentStatus;

    if (['completed', 'done'].includes(nextStatus) && !existing.completedAt) {
      updateData.completedAt = new Date();
    }

    // 5. Build Diffs for Audit Log
    const previousSnapshot: Record<string, any> = {};
    const newSnapshot: Record<string, any> = {};

    for (const [key, val] of Object.entries(updateData)) {
      const prevVal = (existing as any)[key];
      if (prevVal !== val && key !== 'updatedAt') {
        previousSnapshot[key] = prevVal;
        newSnapshot[key] = val;
      }
    }

    // 6. Execute Atomic Transaction
    const updatedOrder = await prisma.$transaction(async (tx) => {
      // If status changed to completed/done, ensure tracker and escrow release
      if (['completed', 'done'].includes(nextStatus) && existing.creatorType === 'g4x') {
        await tx.g4XBoostReleaseTracker.upsert({
          where: { orderId },
          update: {
            stage: G4XBoostReleaseStage.AVAILABLE,
            isReleased: true,
            releasedAt: new Date(),
            adminFinalApprovedAt: new Date(),
            adminFinalApprovedBy: actor.discordId,
            holdDurationHours: 0,
            holdExpiresAt: null,
            notes: reason ? `Admin Edit to ${nextStatus}: ${reason}` : `Admin Edit to ${nextStatus}`,
          },
          create: {
            orderId,
            stage: G4XBoostReleaseStage.AVAILABLE,
            isReleased: true,
            releasedAt: new Date(),
            adminFinalApprovedAt: new Date(),
            adminFinalApprovedBy: actor.discordId,
            holdDurationHours: 0,
            holdExpiresAt: null,
            notes: reason ? `Admin Edit to ${nextStatus}: ${reason}` : `Admin Edit to ${nextStatus}`,
          },
        });

        await tx.ledgerTransaction.updateMany({
          where: { orderId, entryType: 'escrow_lock' },
          data: {
            status: 'released',
            releaseAt: new Date(),
          },
        });
      }

      // If status changed to cancelled, release any reservations
      if (nextStatus === 'cancelled' && existing.status !== 'cancelled') {
        await tx.boosterReservation.updateMany({
          where: { orderId, status: 'active' },
          data: {
            status: 'cancelled',
            releaseReason: reason || 'Cancelled via Admin Edit',
            releasedAt: new Date(),
          },
        });
      }

      const orderResult = await tx.order.update({
        where: { id: orderId },
        data: updateData,
        include: {
          game: { select: { slug: true, displayName: true } },
          service: { select: { id: true, displayName: true, serviceKey: true } },
        },
      });

      // Record Audit Trail
      await tx.auditLog.create({
        data: {
          action: 'ORDER_FULL_UPDATE_BY_ADMIN',
          entityType: 'Order',
          entityId: String(orderId),
          actorId: actor.discordId,
          previousValues: JSON.stringify(previousSnapshot),
          newValues: JSON.stringify(newSnapshot),
          reason: reason ? String(reason).trim() : 'Full order fields modification by administrator/owner',
        },
      });

      return orderResult;
    });

    // 7. Silent Discord Board Synchronisation if published
    if (updatedOrder.discordChannelId && updatedOrder.discordMessageId) {
      try {
        await publishOrRefreshOrderCard(getGlobalDiscordClient(), orderId);
      } catch (err: any) {
        console.warn(`[AdminOrderEdit] Discord board refresh warning for order #${orderId}:`, err?.message || err);
      }
    }

    res.json({
      success: true,
      message: `Order #${orderId} (${updatedOrder.orderRef}) updated successfully.`,
      order: {
        id: updatedOrder.id,
        orderRef: updatedOrder.orderRef,
        title: updatedOrder.title || updatedOrder.orderName,
        orderName: updatedOrder.orderName || updatedOrder.title,
        gameSlug: updatedOrder.gameSlug,
        gameName: updatedOrder.game?.displayName,
        serviceId: updatedOrder.serviceId,
        serviceName: updatedOrder.service?.displayName,
        grossAmountUsd: (updatedOrder.grossAmountMinor / 100).toFixed(2),
        boosterPoolUsd: (updatedOrder.boosterPoolMinor / 100).toFixed(2),
        platformFeeUsd: (updatedOrder.platformFeeMinor / 100).toFixed(2),
        status: updatedOrder.status,
        paymentStatus: updatedOrder.paymentStatus,
        sourceWebsite: updatedOrder.sourceWebsite,
        externalOrderId: updatedOrder.externalOrderId,
        updatedAt: updatedOrder.updatedAt.toISOString(),
      },
    });
  } catch (err: any) {
    console.error(`[AdminOrderEdit] Failed to update order #${orderId}:`, err);
    res.status(500).json({
      error: 'ORDER_UPDATE_FAILED',
      message: err.message || 'Failed to update order details.',
    });
  }
};

adminPortalRouter.put(['/api/admin/orders/:id', '/admin/orders/:id'], requireAuth, requireAdminOrOwner, requireCsrf, handleAdminFullOrderUpdate);
adminPortalRouter.patch(['/api/admin/orders/:id', '/admin/orders/:id'], requireAuth, requireAdminOrOwner, requireCsrf, handleAdminFullOrderUpdate);



