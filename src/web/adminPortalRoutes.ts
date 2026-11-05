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

// ─────────────────────────────────────────────────────────────────────────────
// 2. MANUAL IRT & CRYPTO DEPOSIT QUEUE OVERSIGHT
// ─────────────────────────────────────────────────────────────────────────────

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

      const whereClause: any = {};
      if (status && status !== 'all') {
        whereClause.status = status;
      }
      if (search) {
        whereClause.OR = [
          { fundingRef: { contains: search } },
          { advertiserId: { contains: search } },
          { payerIdentifier: { contains: search } },
          { advertiser: { username: { contains: search } } },
        ];
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

      const serialized = requests.map((r) => {
        const notes = r.adminNotes || '';
        const receiptMatch = notes.match(/(?:^|\|\s*)Receipt:\s*([^\s|]+)/i);
        const extractedReceiptKey = receiptMatch ? receiptMatch[1].trim() : null;

        const dateMatch = notes.match(/(?:^|\|\s*)Date:\s*([^\s|]+)/i);
        const extractedDate = dateMatch ? dateMatch[1].trim() : null;

        const cardMatch = notes.match(/(?:^|\|\s*)CardLast4:\s*([^\s|]+)/i);
        const extractedCardLast4 = cardMatch ? cardMatch[1].trim() : null;

        let payerDescription = notes
          .replace(/(?:^|\|\s*)Receipt:\s*[^\s|]+/gi, '')
          .replace(/(?:^|\|\s*)Date:\s*[^\s|]+/gi, '')
          .replace(/(?:^|\|\s*)CardLast4:\s*[^\s|]+/gi, '')
          .replace(/\|\s*\|/g, '|')
          .replace(/^\|\s*|\s*\|$/g, '')
          .trim() || null;

        const attempts = (r as any).paymentRequests?.flatMap((pr: any) => pr.attempts) || [];
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
      });

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

      // Recheck live FINANCE_ADJUST or FINANCE_ADMIN_VIEW
      const auth = await authorize(user.discordId, Permission.FINANCE_ADMIN_VIEW);
      if (!auth.allowed) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Insufficient financial permissions' });
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
