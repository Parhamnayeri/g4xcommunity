/**
 * operationsRoutes.ts — Express routes for Website Phase 7: React Staff, Management & KYC Portals
 * 
 * Boundaries & Security:
 *  - Staff operational duties: Proof reviews, order pipeline monitoring, dispute queue visibility.
 *  - Management duties: Executive KPIs, order approvals, registration applications, dispute resolution.
 *  - KYC review duties: Strictly guarded by Permission.SENSITIVE_IDENTITY_REVIEW (Manager / Owner ONLY).
 *  - Strict anti self-approval on proofs, disputes, applications and KYC.
 *  - No financial payout or wallet debit triggered by operational approvals.
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../database/db';
import { requireAuth, requireCsrf, AuthenticatedRequest } from './middleware/auth';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import { reviewRunProof, resolveOrderDispute, getDisputesForUser } from '../services/orderDisputeService';
import { recordStaffReview, recordAdminFinalApproval } from '../services/financeV2/g4xBoostReleaseService';
import { getSeparatedOrdersList, getCategorizedOrders, publishOrder, getOrderDiagnostics } from '../services/orderLifecycleService';
import { reviewApplication } from '../services/registrationService';
import { getGlobalDiscordClient } from '../services/orderDiscordService';

export const operationsRouter = Router();

// Storage directory for uploaded KYC evidence
const KYC_DOCS_DIR = path.join(process.cwd(), 'storage', 'kyc_documents');
if (!fs.existsSync(KYC_DOCS_DIR)) {
  fs.mkdirSync(KYC_DOCS_DIR, { recursive: true });
}

// ─── Middleware Guards ────────────────────────────────────────────────────────

/**
 * Ensures user has live server-authoritative operational staff permissions.
 * Evaluates Permission.PROOF_REVIEW (held by staff, admin, manager, owner).
 * Rejects stale/revoked session roles immediately.
 */
async function requireLiveStaffAccess(req: Request, res: Response, next: () => void): Promise<void> {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'AUTHENTICATION_REQUIRED', message: 'You must sign in to access staff operations.' });
    return;
  }
  const auth = await authorize(user.discordId, Permission.PROOF_REVIEW);
  if (!auth.allowed) {
    res.status(403).json({ error: 'STAFF_ACCESS_DENIED', message: 'This view is reserved for authorized staff and management.' });
    return;
  }
  next();
}

/**
 * Ensures user has live server-authoritative management oversight permissions.
 * Evaluates Permission.ORDER_VIEW_PRIVATE or AUDIT_LOG_VIEW (held by manager, admin, owner; staff excluded).
 * Rejects stale/revoked session roles immediately.
 */
async function requireLiveManagementAccess(req: Request, res: Response, next: () => void): Promise<void> {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'AUTHENTICATION_REQUIRED', message: 'You must sign in to access management.' });
    return;
  }
  const [authPrivate, authAudit] = await Promise.all([
    authorize(user.discordId, Permission.ORDER_VIEW_PRIVATE),
    authorize(user.discordId, Permission.AUDIT_LOG_VIEW),
  ]);
  if (!authPrivate.allowed && !authAudit.allowed) {
    res.status(403).json({ error: 'MANAGEMENT_ACCESS_DENIED', message: 'This view requires Manager, Admin, or Owner oversight privileges.' });
    return;
  }
  next();
}

/**
 * Higher-order middleware to require specific live server-authoritative permissions.
 */
function requireLivePermission(permissions: Permission | Permission[]) {
  return async (req: Request, res: Response, next: () => void): Promise<void> => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      res.status(401).json({ error: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' });
      return;
    }
    const perms = Array.isArray(permissions) ? permissions : [permissions];
    for (const p of perms) {
      const auth = await authorize(user.discordId, p);
      if (auth.allowed) {
        return next();
      }
    }
    res.status(403).json({
      error: 'PERMISSION_DENIED',
      message: `Access Denied: Required permission (${perms.join(', ')}) not granted or revoked.`,
    });
  };
}

// Aliases for compatibility
const requireStaffAccess = requireLiveStaffAccess;
const requireManagementAccess = requireLiveManagementAccess;
const requireKycReviewerAccess = requireLivePermission(Permission.SENSITIVE_IDENTITY_REVIEW);

// ═════════════════════════════════════════════════════════════════════════════
// 1. STAFF PORTAL ENDPOINTS (/api/staff/*)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /staff/overview — Summary metrics and personal operational overview for Staff
 */
operationsRouter.get('/staff/overview', requireAuth, requireStaffAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const userRoleKeys = (user.userRoles?.map((r) => r.roleKey) || []).map((r) => r.toLowerCase());

    const [pendingProofsCount, activeDisputesCount, pendingStaffReviewOrdersCount, recentStaffAuditLogs] = await Promise.all([
      prisma.runProof.count({ where: { status: 'pending' } }),
      prisma.orderDispute.count({ where: { status: { in: ['open', 'under_review', 'waiting_for_evidence'] } } }),
      prisma.g4XBoostReleaseTracker.count({ where: { stage: 'proof_submitted', staffReviewedAt: null } }),
      prisma.auditLog.findMany({
        where: {
          actorId: user.discordId,
          action: { in: ['RUN_PROOF_REVIEWED', 'ORDER_STAFF_REVIEWED', 'DISPUTE_NOTES_ADDED', 'DISPUTE_EVIDENCE_REQUESTED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    res.json({
      success: true,
      user: {
        discordId: user.discordId,
        username: user.username,
        displayName: user.displayName,
        roles: userRoleKeys,
        isManagerOrAdmin: userRoleKeys.some((r) => ['owner', 'manager', 'admin'].includes(r)),
      },
      metrics: {
        pendingProofsCount,
        activeDisputesCount,
        pendingStaffReviewOrdersCount,
      },
      recentActivity: recentStaffAuditLogs.map((log: any) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        reason: log.reason,
        createdAt: log.createdAt,
      })),
    });
  } catch (err: any) {
    console.error('[Operations] Staff overview error:', err);
    res.status(500).json({ error: 'Failed to fetch staff operational overview' });
  }
});

/**
 * GET /staff/pending-proofs — Paginated list of completion proofs awaiting staff review
 */
operationsRouter.get('/staff/pending-proofs', requireAuth, requireStaffAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
    const skip = (page - 1) * limit;
    const search = req.query.search ? String(req.query.search).trim() : undefined;

    const where: any = { status: 'pending' };
    if (search) {
      where.OR = [
        { evidenceUrl: { contains: search } },
        { description: { contains: search } },
        { submittedBy: { username: { contains: search } } },
        { run: { order: { orderRef: { contains: search } } } },
      ];
    }

    const [total, proofs] = await Promise.all([
      prisma.runProof.count({ where }),
      prisma.runProof.findMany({
        where,
        include: {
          submittedBy: {
            select: { discordId: true, username: true, displayName: true },
          },
          run: {
            include: {
              order: {
                select: {
                  id: true,
                  orderRef: true,
                  orderName: true,
                  gameSlug: true,
                  creatorType: true,
                  status: true,
                  boosterPoolMinor: true,
                },
              },
            },
          },
        },
        orderBy: { submittedAt: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      proofs: proofs.map((p) => ({
        id: p.id,
        runId: p.runId,
        runNumber: p.run.runNumber,
        orderId: p.run.orderId,
        orderRef: p.run.order.orderRef,
        orderName: p.run.order.orderName,
        gameSlug: p.run.order.gameSlug,
        creatorType: p.run.order.creatorType,
        proofType: p.proofType,
        evidenceUrl: p.evidenceUrl,
        description: p.description,
        status: p.status,
        submittedAt: p.submittedAt,
        submittedBy: {
          discordId: p.submittedBy.discordId,
          username: p.submittedBy.username,
          displayName: p.submittedBy.displayName,
        },
      })),
    });
  } catch (err: any) {
    console.error('[Operations] Fetch pending proofs error:', err);
    res.status(500).json({ error: 'Failed to fetch pending proofs' });
  }
});

/**
 * POST /staff/proofs/:id/review — Review and approve/reject a run completion proof
 */
operationsRouter.post('/staff/proofs/:id/review', requireAuth, requireStaffAccess, requireCsrf, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const proofId = Number(req.params.id);
    if (isNaN(proofId) || proofId <= 0) {
      res.status(400).json({ error: 'INVALID_PROOF_ID', message: 'Valid proof ID required' });
      return;
    }

    const rawDecision = req.body.decision || req.body.action;
    const decision = rawDecision === 'approved' ? 'approve' : rawDecision === 'rejected' ? 'reject' : rawDecision;
    const notes = req.body.reviewNotes || req.body.notes;

    if (!['approve', 'reject'].includes(decision)) {
      res.status(400).json({ error: 'INVALID_DECISION', message: "Decision must be 'approve' or 'reject'" });
      return;
    }

    const existingProof = await prisma.runProof.findUnique({ where: { id: proofId } });
    if (!existingProof) {
      res.status(404).json({ error: 'PROOF_NOT_FOUND', message: `RunProof #${proofId} not found` });
      return;
    }

    if (existingProof.submittedById === user.discordId) {
      res.status(403).json({ error: 'CANNOT_REVIEW_OWN_PROOF', message: 'Submitters cannot review or approve their own completion proof.' });
      return;
    }

    if (existingProof.status !== 'pending') {
      res.status(400).json({ error: 'PROOF_ALREADY_REVIEWED', message: `Proof #${proofId} has already been reviewed (status: ${existingProof.status})` });
      return;
    }

    const reviewed = await reviewRunProof({
      proofId,
      reviewerId: user.discordId,
      decision,
      reviewNotes: notes?.trim() || null,
      discordClient: getGlobalDiscordClient(),
    });

    res.json({
      success: true,
      message: `Proof #${proofId} has been successfully ${decision}d.`,
      proof: reviewed,
    });
  } catch (err: any) {
    const status = err.code === 'SELF_APPROVAL_PROHIBITED' ? 403 : err.name === 'DomainError' ? 400 : 500;
    res.status(status).json({ error: err.code || 'REVIEW_FAILED', message: err.message || 'Proof review failed' });
  }
});

/**
 * POST /staff/orders/:id/review — Staff review of completed boost order run
 */
operationsRouter.post('/staff/orders/:id/review', requireAuth, requireStaffAccess, requireCsrf, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const orderId = Number(req.params.id);
    if (isNaN(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'INVALID_ORDER_ID', message: 'Valid order ID required' });
      return;
    }

    const { notes } = req.body;
    const tracker = await recordStaffReview(orderId, user.discordId, notes);

    res.json({
      success: true,
      message: `Order #${orderId} marked as staff-reviewed. Awaiting final administrative approval.`,
      tracker,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'STAFF_REVIEW_FAILED', message: err.message || 'Staff order review failed' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. MANAGEMENT PORTAL ENDPOINTS (/api/management/*)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /management/overview — Executive operational dashboard with real KPIs and pipeline health
 */
operationsRouter.get('/management/overview', requireAuth, requireManagementAccess, async (_req: Request, res: Response): Promise<void> => {
  try {
    const [categorized, g4xOrdersCount, advOrdersCount, pendingAppsCount, pendingKycCount, openDisputesCount, activeBoostersCount, activeReservationsCount, recentPlatformAuditLogs] = await Promise.all([
      getCategorizedOrders({}),
      prisma.order.count({ where: { creatorType: 'g4x' } }),
      prisma.order.count({ where: { creatorType: 'advertiser' } }),
      prisma.registrationApplication.count({ where: { status: { in: ['pending', 'under_review', 'info_requested'] } } }),
      prisma.registrationApplication.count({
        where: {
          category: { in: ['pilot', 'exchanger'] },
          status: { in: ['pending', 'under_review', 'info_requested', 'awaiting_identity_verification'] },
        },
      }),
      prisma.orderDispute.count({ where: { status: { in: ['open', 'under_review', 'waiting_for_evidence'] } } }),
      prisma.userRole.count({ where: { roleKey: 'booster' } }),
      prisma.boosterReservation.count({ where: { status: 'active' } }),
      prisma.auditLog.findMany({
        where: {
          action: { in: ['ORDER_ADMIN_APPROVED', 'ORDER_PUBLISHED', 'REGISTRATION_APPLICATION_REVIEWED', 'DISPUTE_RESOLVED', 'PILOT_VERIFICATION_REVIEWED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const totalActiveOrders =
      (categorized.counts.pending_payment || 0) +
      (categorized.counts.publishable || 0) +
      (categorized.counts.published || 0) +
      (categorized.counts.in_progress || 0) +
      (categorized.counts.proof_review || 0);

    const auditTrailList = recentPlatformAuditLogs.map((log: any) => ({
      id: log.id,
      actorId: log.actorId,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      reason: log.reason,
      createdAt: log.createdAt,
    }));

    res.json({
      success: true,
      kpis: {
        activeOrdersCount: totalActiveOrders,
        externalOrdersCount: g4xOrdersCount,
        advertiserOrdersCount: advOrdersCount,
        openDisputesCount,
        pendingProofsCount: 0,
        pendingApplicationsCount: pendingAppsCount,
        pendingKycVerificationsCount: pendingKycCount,
        totalActiveBoosters: activeBoostersCount,
      },
      pipeline: {
        counts: categorized.counts,
        g4xOrdersCount,
        advertiserOrdersCount: advOrdersCount,
      },
      capacity: {
        activeBoostersCount,
        activeReservationsCount,
      },
      queues: {
        pendingRegistrationApplicationsCount: pendingAppsCount,
        pendingKycCount,
        openDisputesCount,
      },
      recentManagementAudit: auditTrailList,
      recentAuditTrail: auditTrailList,
    });
  } catch (err: any) {
    console.error('[Operations] Management overview error:', err);
    res.status(500).json({ error: 'Failed to fetch management overview' });
  }
});

/**
 * GET /management/orders — Separated order pipeline (G4X vs Advertiser) with pagination & filters
 */
operationsRouter.get('/management/orders', requireAuth, requireLivePermission(Permission.ORDER_VIEW_PRIVATE), async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const tab = req.query.tab === 'advertiser' ? 'advertiser' : 'g4x';

    const result = await getSeparatedOrdersList({
      tab,
      origin: tab as any,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 15,
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
    console.error('[Operations] Management orders error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch management orders' });
  }
});

/**
 * POST /management/orders/:id/approve — Management final operational approval of completed boost
 */
operationsRouter.post('/management/orders/:id/approve', requireAuth, requireLivePermission(Permission.ORDER_FINAL_APPROVE), requireCsrf, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const orderId = Number(req.params.id);
    if (isNaN(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'INVALID_ORDER_ID', message: 'Valid order ID required' });
      return;
    }

    const { notes } = req.body;
    const tracker = await recordAdminFinalApproval(orderId, user.discordId, notes);

    res.json({
      success: true,
      message: `Order #${orderId} has been given final operational approval.`,
      tracker,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'APPROVAL_FAILED', message: err.message || 'Admin final approval failed' });
  }
});

/**
 * POST /management/orders/:id/publish — Publish validated order to Discord Orders Board
 */
operationsRouter.post('/management/orders/:id/publish', requireAuth, requireLivePermission(Permission.ORDER_PUBLISH), requireCsrf, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const orderId = Number(req.params.id);
    if (isNaN(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'INVALID_ORDER_ID', message: 'Valid order ID required' });
      return;
    }

    const result = await publishOrder(orderId, user.discordId, getGlobalDiscordClient());
    res.json({
      success: true,
      message: `Order #${orderId} published to Discord Orders Board.`,
      channelId: (result as any).channelId,
      messageId: (result as any).messageId,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'PUBLISH_FAILED', message: err.message || 'Failed to publish order' });
  }
});

/**
 * GET /management/applications — Registration applications queue (booster, pilot, advertiser, exchanger)
 */
operationsRouter.get('/management/applications', requireAuth, requireLivePermission([
  Permission.BOOSTER_APPLICATION_REVIEW,
  Permission.PILOT_APPLICATION_REVIEW,
  Permission.ADVERTISER_APPLICATION_REVIEW,
  Permission.EXCHANGER_APPLICATION_REVIEW,
]), async (req: Request, res: Response): Promise<void> => {
  try {
    const category = req.query.category ? String(req.query.category) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (category) where.category = category;
    if (status) {
      where.status = status;
    } else {
      where.status = { in: ['pending', 'under_review', 'info_requested', 'awaiting_identity_verification'] };
    }

    const [total, applications] = await Promise.all([
      prisma.registrationApplication.count({ where }),
      prisma.registrationApplication.findMany({
        where,
        include: {
          user: {
            select: { discordId: true, username: true, displayName: true },
          },
          game: { select: { slug: true, displayName: true } },
          service: { select: { id: true, displayName: true } },
          reviewedBy: { select: { discordId: true, username: true, displayName: true } },
        },
        orderBy: { submittedAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      applications,
    });
  } catch (err: any) {
    console.error('[Operations] Management applications error:', err);
    res.status(500).json({ error: 'Failed to fetch registration applications' });
  }
});

/**
 * POST /management/applications/:id/review — Review registration application with anti self-review and category permissions
 */
operationsRouter.post('/management/applications/:id/review', requireAuth, requireCsrf, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const applicationId = Number(req.params.id);
    if (isNaN(applicationId) || applicationId <= 0) {
      res.status(400).json({ error: 'INVALID_APPLICATION_ID', message: 'Valid application ID required' });
      return;
    }

    const existingApp = await prisma.registrationApplication.findUnique({ where: { id: applicationId } });
    if (!existingApp) {
      res.status(404).json({ error: 'APPLICATION_NOT_FOUND', message: `Application #${applicationId} not found` });
      return;
    }

    if (existingApp.userId === user.discordId) {
      res.status(403).json({ error: 'CANNOT_REVIEW_OWN_APPLICATION', message: 'Reviewers cannot review their own application' });
      return;
    }

    const { decision, reason, reviewerNotes } = req.body;
    if (!['approve', 'reject', 'request_info', 'start_identity_verification', 'verify_identity'].includes(decision)) {
      res.status(400).json({ error: 'INVALID_DECISION', message: 'Invalid review decision specified' });
      return;
    }

    // Dynamic Server-Authoritative Category Permission Enforcement
    let requiredPermission = Permission.BOOSTER_APPLICATION_REVIEW;
    if (existingApp.category === 'pilot') {
      requiredPermission = Permission.PILOT_APPLICATION_REVIEW;
    } else if (existingApp.category === 'advertiser') {
      requiredPermission = Permission.ADVERTISER_APPLICATION_REVIEW;
    } else if (existingApp.category === 'exchanger') {
      requiredPermission = Permission.EXCHANGER_APPLICATION_REVIEW;
    }

    if (decision === 'start_identity_verification' || decision === 'verify_identity') {
      requiredPermission = Permission.SENSITIVE_IDENTITY_REVIEW;
    }

    const auth = await authorize(user.discordId, requiredPermission);
    if (!auth.allowed) {
      res.status(403).json({
        error: 'UNAUTHORIZED_REVIEWER',
        message: `Insufficient permissions: '${requiredPermission}' required to evaluate ${existingApp.category} applications.`,
      });
      return;
    }

    const updated = await reviewApplication({
      reviewerId: user.discordId,
      applicationId,
      decision,
      reason,
      reviewNotes: reviewerNotes || (req.body as any).reviewNotes,
      discordClient: getGlobalDiscordClient(),
    });

    res.json({
      success: true,
      message: `Application #${applicationId} decision '${decision}' successfully applied.`,
      application: updated,
    });
  } catch (err: any) {
    const isForbidden = err.code === 'SELF_REVIEW_PROHIBITED' ||
      err.code === 'UNAUTHORIZED_REVIEWER' ||
      err.message?.includes('UNAUTHORIZED_REVIEWER') ||
      err.message?.includes('CANNOT_REVIEW_OWN_APPLICATION');
    const status = isForbidden ? 403 : 400;
    res.status(status).json({ error: err.code || 'REVIEW_FAILED', message: err.message || 'Application review failed' });
  }
});

/**
 * GET /management/disputes — Full disputes queue for management
 */
operationsRouter.get('/management/disputes', requireAuth, requireLivePermission(Permission.DISPUTE_REVIEW), async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const statusFilter = req.query.status ? String(req.query.status) : undefined;
    const disputes = await getDisputesForUser(user.discordId, true, { status: statusFilter });
    res.json({ success: true, disputes });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch disputes' });
  }
});

/**
 * POST /management/disputes/:id/resolve — Management resolution of order dispute with anti self-approval
 */
operationsRouter.post('/management/disputes/:id/resolve', requireAuth, requireLivePermission(Permission.DISPUTE_RESOLVE), requireCsrf, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const disputeId = Number(req.params.id);
    if (isNaN(disputeId) || disputeId <= 0) {
      res.status(400).json({ error: 'INVALID_DISPUTE_ID', message: 'Valid dispute ID required' });
      return;
    }

    const existingDispute = await prisma.orderDispute.findUnique({ where: { id: disputeId } });
    if (!existingDispute) {
      res.status(404).json({ error: 'DISPUTE_NOT_FOUND', message: `Dispute #${disputeId} not found` });
      return;
    }

    if (existingDispute.openedById === user.discordId) {
      res.status(403).json({ error: 'CANNOT_RESOLVE_OWN_DISPUTE', message: 'Claimants cannot resolve their own opened dispute.' });
      return;
    }

    const rawDecision = req.body.decision;
    const notes = req.body.resolutionNotes || req.body.notes;
    let decision = rawDecision;
    if (['release_booster', 'refund_customer', 'split'].includes(rawDecision)) {
      decision = 'resolved';
    } else if (rawDecision === 'dismiss') {
      decision = 'rejected';
    }

    if (!['resolved', 'rejected', 'cancelled'].includes(decision)) {
      res.status(400).json({ error: 'INVALID_DECISION', message: "Decision must be 'resolved', 'rejected', or 'cancelled'" });
      return;
    }

    const result = await resolveOrderDispute({
      disputeId,
      resolverId: user.discordId,
      decision,
      resolutionNotes: notes,
      discordClient: getGlobalDiscordClient(),
    });

    res.json({
      success: true,
      message: `Dispute #${disputeId} concluded as '${decision}'.`,
      dispute: result,
    });
  } catch (err: any) {
    const status = err.code === 'SELF_RESOLUTION_PROHIBITED' ? 403 : err.name === 'DomainError' ? 400 : 500;
    res.status(status).json({ error: err.code || 'RESOLVE_FAILED', message: err.message || 'Dispute resolution failed' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. KYC MANAGEMENT PORTAL ENDPOINTS (/api/management/kyc/*)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /management/kyc/applications — Secure list of KYC and pilot identity applications
 * Strictly guarded by Permission.SENSITIVE_IDENTITY_REVIEW (Manager/Owner only).
 */
operationsRouter.get('/management/kyc/applications', requireAuth, requireKycReviewerAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const category = req.query.category ? String(req.query.category) : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
    const skip = (page - 1) * limit;

    const where: any = {
      OR: [
        { category: { in: ['pilot', 'exchanger'] } },
        { identityStatus: { not: 'none' } },
      ],
    };

    if (category) {
      where.category = category;
    }

    if (status && status !== 'all') {
      if (status === 'pending') {
        where.status = { in: ['pending', 'under_review', 'awaiting_identity_verification', 'info_requested'] };
      } else {
        where.status = status;
      }
    }

    const [total, applications] = await Promise.all([
      prisma.registrationApplication.count({ where }),
      prisma.registrationApplication.findMany({
        where,
        include: {
          user: {
            select: { discordId: true, username: true, displayName: true, createdAt: true },
          },
          game: { select: { slug: true, displayName: true } },
          service: { select: { id: true, displayName: true } },
          reviewedBy: { select: { discordId: true, username: true, displayName: true } },
        },
        orderBy: { submittedAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    // Also fetch associated PilotVerification records to display verification status
    const userIds = applications.map((a) => a.userId);
    const pilotVerifications = await prisma.pilotVerification.findMany({
      where: { userId: { in: userIds } },
    });

    const kycItems = applications.map((app) => {
      const pVerif = pilotVerifications.find((pv) => pv.userId === app.userId && (!app.gameSlug || pv.gameSlug === app.gameSlug));
      
      let parsedQualifications: any = {};
      try {
        parsedQualifications = JSON.parse(app.qualifications || '{}');
      } catch {
        parsedQualifications = { raw: app.qualifications };
      }

      return {
        id: app.id,
        userId: app.userId,
        applicant: {
          discordId: app.user.discordId,
          username: app.user.username,
          displayName: app.user.displayName,
          joinedAt: app.user.createdAt,
        },
        category: app.category,
        gameSlug: app.gameSlug,
        gameDisplayName: app.game?.displayName || app.gameSlug || 'Universal',
        status: app.status,
        identityStatus: app.identityStatus,
        pilotVerificationStatus: pVerif?.status || 'none',
        hasIdentityDoc: Boolean(pVerif?.identityDocumentRef || parsedQualifications?.identityDocumentRef),
        hasPassportDoc: Boolean(pVerif?.passportDocumentRef || parsedQualifications?.passportDocumentRef),
        hasSelfieDoc: Boolean(pVerif?.selfieDocumentRef || parsedQualifications?.selfieDocumentRef),
        submittedAt: app.submittedAt,
        reviewedAt: app.reviewedAt,
        reviewedBy: app.reviewedBy ? { username: app.reviewedBy.username, displayName: app.reviewedBy.displayName } : null,
        rejectionReason: app.rejectionReason,
        reviewNotes: app.reviewNotes,
      };
    });

    res.json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      applications: kycItems,
    });
  } catch (err: any) {
    console.error('[Operations] KYC applications list error:', err);
    res.status(500).json({ error: 'Failed to retrieve KYC applications' });
  }
});

/**
 * GET /management/kyc/applications/:id — Detailed KYC application data for reviewer
 */
operationsRouter.get('/management/kyc/applications/:id', requireAuth, requireKycReviewerAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const applicationId = Number(req.params.id);
    if (isNaN(applicationId) || applicationId <= 0) {
      res.status(400).json({ error: 'INVALID_ID', message: 'Valid application ID required' });
      return;
    }

    const application = await prisma.registrationApplication.findUnique({
      where: { id: applicationId },
      include: {
        user: {
          select: { discordId: true, username: true, displayName: true, phoneNumber: true, telegramUsername: true, whatsappNumber: true, createdAt: true },
        },
        game: true,
        service: true,
        reviewedBy: {
          select: { discordId: true, username: true, displayName: true },
        },
      },
    });

    if (!application) {
      res.status(404).json({ error: 'APPLICATION_NOT_FOUND', message: 'KYC application not found' });
      return;
    }

    // Fetch pilot verification record if applicable
    const pilotVerification = await prisma.pilotVerification.findFirst({
      where: {
        userId: application.userId,
        ...(application.gameSlug ? { gameSlug: application.gameSlug } : {}),
      },
    });

    // Fetch audit history for this application
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityType: 'RegistrationApplication',
        entityId: String(applicationId),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    let qualifications: any = {};
    try {
      qualifications = JSON.parse(application.qualifications || '{}');
    } catch {
      qualifications = { raw: application.qualifications };
    }

    // Mask actual filesystem paths; provide secure document keys
    const documents = {
      identityDoc: pilotVerification?.identityDocumentRef || qualifications?.identityDocumentRef || null,
      passportDoc: pilotVerification?.passportDocumentRef || qualifications?.passportDocumentRef || null,
      selfieDoc: pilotVerification?.selfieDocumentRef || qualifications?.selfieDocumentRef || null,
    };

    res.json({
      success: true,
      application: {
        id: application.id,
        userId: application.userId,
        applicant: application.user,
        category: application.category,
        gameSlug: application.gameSlug,
        gameName: application.game?.displayName || application.gameSlug,
        serviceName: application.service?.displayName || null,
        preferredLanguage: application.preferredLanguage,
        status: application.status,
        identityStatus: application.identityStatus,
        pilotVerificationStatus: pilotVerification?.status || 'none',
        qualifications,
        supplementalInfo: application.supplementalInfo,
        rejectionReason: application.rejectionReason,
        reviewNotes: application.reviewNotes,
        submittedAt: application.submittedAt,
        infoRequestedAt: application.infoRequestedAt,
        infoRespondedAt: application.infoRespondedAt,
        reviewedAt: application.reviewedAt,
        reviewedBy: application.reviewedBy,
        documents: {
          hasIdentityDoc: Boolean(documents.identityDoc),
          hasPassportDoc: Boolean(documents.passportDoc),
          hasSelfieDoc: Boolean(documents.selfieDoc),
          identityDocKey: documents.identityDoc ? path.basename(documents.identityDoc) : null,
          passportDocKey: documents.passportDoc ? path.basename(documents.passportDoc) : null,
          selfieDocKey: documents.selfieDoc ? path.basename(documents.selfieDoc) : null,
        },
      },
      auditHistory: auditLogs.map((l) => ({
        id: l.id,
        actorId: l.actorId,
        action: l.action,
        reason: l.reason,
        createdAt: l.createdAt,
      })),
    });
  } catch (err: any) {
    console.error('[Operations] KYC application detail error:', err);
    res.status(500).json({ error: 'Failed to fetch KYC application details' });
  }
});

/**
 * POST /management/kyc/applications/:id/decision — Execute authoritative KYC decision
 * Decisions:
 *  - verify_identity: Approves identity status and marks PilotVerification as approved.
 *  - start_identity_verification: Moves application to awaiting_identity_verification.
 *  - request_info: Asks applicant for more details.
 *  - reject: Rejects identity verification with mandatory reason.
 */
operationsRouter.post('/management/kyc/applications/:id/decision', requireAuth, requireKycReviewerAccess, requireCsrf, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const applicationId = Number(req.params.id);
    if (isNaN(applicationId) || applicationId <= 0) {
      res.status(400).json({ error: 'INVALID_APPLICATION_ID', message: 'Valid application ID required' });
      return;
    }

    const { decision, reason, reviewNotes } = req.body;
    const validDecisions = ['verify_identity', 'start_identity_verification', 'request_info', 'reject', 'approve'];
    if (!validDecisions.includes(decision)) {
      res.status(400).json({ error: 'INVALID_DECISION', message: `Decision must be one of: ${validDecisions.join(', ')}` });
      return;
    }

    if (decision === 'reject' && (!reason || reason.trim().length < 5)) {
      res.status(400).json({ error: 'REASON_REQUIRED', message: 'A rejection reason with at least 5 characters is mandatory.' });
      return;
    }

    const application = await prisma.registrationApplication.findUnique({
      where: { id: applicationId },
    });

    if (!application) {
      res.status(404).json({ error: 'APPLICATION_NOT_FOUND', message: 'Application does not exist' });
      return;
    }

    // Strict Anti Self-Review Protection
    if (application.userId === user.discordId) {
      res.status(403).json({ error: 'SELF_REVIEW_PROHIBITED', message: 'Reviewers cannot evaluate or approve their own KYC application.' });
      return;
    }

    const updated = await reviewApplication({
      reviewerId: user.discordId,
      applicationId,
      decision,
      reason: reason?.trim() || undefined,
      reviewNotes: reviewNotes?.trim() || undefined,
      discordClient: getGlobalDiscordClient(),
    });

    res.json({
      success: true,
      message: `KYC application #${applicationId} decision '${decision}' successfully executed.`,
      application: updated,
    });
  } catch (err: any) {
    console.error('[Operations] KYC decision error:', err);
    res.status(400).json({ error: 'KYC_DECISION_FAILED', message: err.message || 'KYC decision processing failed' });
  }
});

/**
 * Shared helper to authoritatively serve a KYC document:
 *  - Enforces SENSITIVE_IDENTITY_REVIEW permission
 *  - Resolves target application and checks eligibility
 *  - Validates document is registered in DB for this application
 *  - Derives filename strictly from trusted database metadata
 *  - Verifies realpath containment and rejects symlinks
 *  - Sets no-cache, no-store, nosniff and security headers
 *  - Never exposes filesystem paths or sensitive error details
 */
async function serveSecureKycDocument(
  res: Response,
  applicationId: number,
  docTypeOrRef: string,
  byDocType: boolean
): Promise<void> {
  if (isNaN(applicationId) || applicationId <= 0) {
    res.status(400).json({ error: 'INVALID_APPLICATION_ID', message: 'Valid application ID required' });
    return;
  }

  const application = await prisma.registrationApplication.findUnique({
    where: { id: applicationId },
  });
  if (!application) {
    res.status(404).json({ error: 'APPLICATION_NOT_FOUND', message: 'Application not found' });
    return;
  }

  const isEligible = ['pilot', 'exchanger'].includes(application.category) || (application.identityStatus && application.identityStatus !== 'none');
  if (!isEligible) {
    res.status(400).json({ error: 'INELIGIBLE_FOR_KYC', message: 'Application is not eligible for KYC document review' });
    return;
  }

  const pilotVerif = await prisma.pilotVerification.findFirst({
    where: {
      userId: application.userId,
      ...(application.gameSlug ? { gameSlug: application.gameSlug } : {}),
    },
  });

  let qualDocs: any = {};
  try {
    qualDocs = JSON.parse(application.qualifications || '{}');
  } catch {}

  const registeredDocs: Record<string, string | null> = {
    identity: pilotVerif?.identityDocumentRef || qualDocs?.identityDocumentRef || null,
    identitydoc: pilotVerif?.identityDocumentRef || qualDocs?.identityDocumentRef || null,
    passport: pilotVerif?.passportDocumentRef || qualDocs?.passportDocumentRef || null,
    passportdoc: pilotVerif?.passportDocumentRef || qualDocs?.passportDocumentRef || null,
    selfie: pilotVerif?.selfieDocumentRef || qualDocs?.selfieDocumentRef || null,
    selfiedoc: pilotVerif?.selfieDocumentRef || qualDocs?.selfieDocumentRef || null,
  };

  let trustedDocRef: string | null = null;
  if (byDocType) {
    const normalizedType = docTypeOrRef.toLowerCase().trim();
    trustedDocRef = registeredDocs[normalizedType] || null;
    if (!trustedDocRef) {
      res.status(404).json({ error: 'DOCUMENT_NOT_FOUND', message: 'Requested document type not registered for this application' });
      return;
    }
  } else {
    // Matching by docRef: Must belong to this application's registered documents
    const requestedBase = path.basename(docTypeOrRef);
    const matchesAny = Object.values(registeredDocs).some(
      (ref) => ref && path.basename(ref) === requestedBase
    );
    if (!matchesAny) {
      res.status(403).json({ error: 'DOCUMENT_NOT_ASSOCIATED', message: 'Document does not belong to the authorized application' });
      return;
    }
    trustedDocRef = requestedBase;
  }

  const baseName = path.basename(trustedDocRef);
  if (baseName.includes('..') || baseName.includes('/') || baseName.includes('\\') || baseName !== trustedDocRef) {
    res.status(400).json({ error: 'PATH_TRAVERSAL_DETECTED', message: 'Invalid document reference format' });
    return;
  }

  const safeRegex = /^[a-zA-Z0-9_\-\.]+\.(png|jpg|jpeg|webp|pdf)$/i;
  if (!safeRegex.test(baseName)) {
    res.status(400).json({ error: 'DISALLOWED_DOC_TYPE', message: 'Disallowed document format or extension' });
    return;
  }

  const targetPath = path.resolve(KYC_DOCS_DIR, baseName);
  if (!fs.existsSync(targetPath)) {
    res.status(404).json({ error: 'DOCUMENT_NOT_FOUND', message: 'Document file not found on secure storage' });
    return;
  }

  // Symlink check
  const lstat = fs.lstatSync(targetPath);
  if (lstat.isSymbolicLink()) {
    res.status(403).json({ error: 'ILLEGAL_LINK_DETECTED', message: 'Symbolic links are strictly prohibited' });
    return;
  }

  // Canonical realpath containment check
  const realKycDir = fs.realpathSync(KYC_DOCS_DIR);
  const canonicalPath = fs.realpathSync(targetPath);
  if (!canonicalPath.startsWith(realKycDir + path.sep)) {
    res.status(403).json({ error: 'PATH_TRAVERSAL_DETECTED', message: 'Path traversal or symlink escape detected' });
    return;
  }

  const ext = path.extname(baseName).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
  };

  res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.sendFile(canonicalPath);
}

/**
 * GET /management/kyc/applications/:id/documents/:docType — Application-scoped secure document file access
 * Enforces SENSITIVE_IDENTITY_REVIEW, application ownership, and realpath containment.
 */
operationsRouter.get('/management/kyc/applications/:id/documents/:docType', requireAuth, requireKycReviewerAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const applicationId = Number(req.params.id);
    const docType = req.params.docType;
    await serveSecureKycDocument(res, applicationId, docType, true);
  } catch (err: any) {
    res.status(500).json({ error: 'DOC_RETRIEVAL_FAILED', message: 'Failed to retrieve document' });
  }
});

/**
 * GET /management/kyc/documents/:docRef — Direct document file access with application binding
 * Validates docRef format, requires applicationId query, verifies ownership and containment.
 */
operationsRouter.get('/management/kyc/documents/:docRef', requireAuth, requireKycReviewerAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const rawRef = req.params.docRef;
    if (!rawRef || typeof rawRef !== 'string') {
      res.status(400).json({ error: 'INVALID_DOC_REF', message: 'Document reference required' });
      return;
    }

    if (rawRef.includes('..') || rawRef.includes('/') || rawRef.includes('\\') || path.basename(rawRef) !== rawRef) {
      res.status(400).json({ error: 'PATH_TRAVERSAL_DETECTED', message: 'Invalid document reference format' });
      return;
    }

    const applicationId = Number(req.query.applicationId);
    if (!applicationId || isNaN(applicationId) || applicationId <= 0) {
      res.status(400).json({ error: 'APPLICATION_ID_REQUIRED', message: 'Application ID is required to verify document ownership' });
      return;
    }

    await serveSecureKycDocument(res, applicationId, rawRef, false);
  } catch (err: any) {
    res.status(500).json({ error: 'DOC_RETRIEVAL_FAILED', message: 'Failed to retrieve document' });
  }
});
