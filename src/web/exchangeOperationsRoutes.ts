/**
 * src/web/exchangeOperationsRoutes.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 7:
 * Participant Proofs, Buyer Confirmation, Dispute Management,
 * and Full Admin Operations Workspace APIs.
 */

import { Router, Request, Response } from 'express';
import prisma from '../database/db';
import { requireAuth, requireCsrf, AuthenticatedRequest } from './middleware/auth';
import { requireOwnerOrStaff } from './exchangeConfigRoutes';
import {
  submitExchangeProof,
  confirmExchangeDeliveryByBuyer,
  requestAdditionalProof,
  addTradeInternalNote,
  rejectTradeFinalApproval,
  approveAndSettleExchangeTrade,
  getExchangeProofsForTrade,
  getSettlementByTradeId,
} from '../services/exchangeSettlementService';
import {
  openExchangeDispute,
  resolveExchangeDispute,
  getExchangeDisputeById,
  getExchangeDisputeByTradeId,
  listExchangeDisputes,
  DisputeCategory,
  DisputeResolutionOutcome,
} from '../services/exchangeDisputeService';
import { TradeValidationError } from '../services/exchangeTradeService';

export const exchangeOperationsRouter = Router();

function isStaffOrOwner(user: any): boolean {
  if (!user) return false;
  const roleKeys = (user.userRoles || []).map((r: any) => r.roleKey.toLowerCase());
  return (
    roleKeys.includes('owner') ||
    roleKeys.includes('admin') ||
    roleKeys.includes('manager') ||
    roleKeys.includes('management') ||
    roleKeys.includes('staff') ||
    (Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PART A: PARTICIPANT ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/exchange/trades/:tradeId/proofs
 * Submits delivery evidence / proof for a trade
 */
exchangeOperationsRouter.post(
  '/api/exchange/trades/:tradeId/proofs',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;
      const { proofType, fileUrl, evidenceLinks, inGameDetails, note } = req.body;

      const trade = await prisma.exchangeTrade.findUnique({ where: { id: tradeId } });
      if (!trade) {
        res.status(404).json({ error: 'Trade not found' });
        return;
      }

      const isBuyer = trade.buyerUserId === user.discordId || trade.buyerDiscordId === user.discordId;
      const isSeller = trade.sellerUserId === user.discordId || trade.sellerDiscordId === user.discordId;
      const staff = isStaffOrOwner(user);

      if (!isBuyer && !isSeller && !staff) {
        res.status(403).json({ error: 'Forbidden', message: 'You are not a participant in this trade.' });
        return;
      }

      const submitterRole = staff ? 'ADMIN' : isSeller ? 'SELLER' : 'BUYER';

      const proof = await submitExchangeProof({
        tradeId,
        submittedByUserId: user.discordId,
        submittedByDiscordId: user.discordId,
        submitterRole,
        proofType,
        fileUrl,
        evidenceLinks,
        inGameDetails,
        note,
      });

      res.status(201).json({ success: true, proof });
    } catch (err: any) {
      if (err instanceof TradeValidationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Failed to submit exchange proof:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * GET /api/exchange/trades/:tradeId/proofs
 * Lists all proofs submitted for a trade
 */
exchangeOperationsRouter.get(
  '/api/exchange/trades/:tradeId/proofs',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;

      const trade = await prisma.exchangeTrade.findUnique({ where: { id: tradeId } });
      if (!trade) {
        res.status(404).json({ error: 'Trade not found' });
        return;
      }

      const isBuyer = trade.buyerUserId === user.discordId || trade.buyerDiscordId === user.discordId;
      const isSeller = trade.sellerUserId === user.discordId || trade.sellerDiscordId === user.discordId;
      const staff = isStaffOrOwner(user);

      if (!isBuyer && !isSeller && !staff) {
        res.status(403).json({ error: 'Forbidden', message: 'You are not a participant in this trade.' });
        return;
      }

      const proofs = await getExchangeProofsForTrade(tradeId);
      res.json({ success: true, proofs });
    } catch (err: any) {
      console.error('Failed to list exchange proofs:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * POST /api/exchange/trades/:tradeId/confirm-delivery
 * Buyer confirms receipt of goods -> sets trade to AWAITING_FINAL_APPROVAL.
 * Strictly NO wallet mutation or escrow release here!
 */
exchangeOperationsRouter.post(
  '/api/exchange/trades/:tradeId/confirm-delivery',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;
      const { note } = req.body;

      const updatedTrade = await confirmExchangeDeliveryByBuyer({
        tradeId,
        buyerUserId: user.discordId,
        buyerDiscordId: user.discordId,
        note,
      });

      res.json({
        success: true,
        trade: updatedTrade,
        message: 'Delivery confirmed. Trade placed in Final Review queue.',
      });
    } catch (err: any) {
      if (err instanceof TradeValidationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Failed to confirm delivery:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * POST /api/exchange/trades/:tradeId/disputes
 * Opens a formal dispute on a trade
 */
exchangeOperationsRouter.post(
  '/api/exchange/trades/:tradeId/disputes',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;
      const { category, description, evidenceLinks } = req.body;

      const trade = await prisma.exchangeTrade.findUnique({ where: { id: tradeId } });
      if (!trade) {
        res.status(404).json({ error: 'Trade not found' });
        return;
      }

      const isBuyer = trade.buyerUserId === user.discordId || trade.buyerDiscordId === user.discordId;
      const isSeller = trade.sellerUserId === user.discordId || trade.sellerDiscordId === user.discordId;
      const staff = isStaffOrOwner(user);

      if (!isBuyer && !isSeller && !staff) {
        res.status(403).json({ error: 'Forbidden', message: 'You are not a participant in this trade.' });
        return;
      }

      const openedByRole = staff ? 'ADMIN' : isSeller ? 'SELLER' : 'BUYER';

      const dispute = await openExchangeDispute({
        tradeId,
        openedByUserId: user.discordId,
        openedByDiscordId: user.discordId,
        openedByRole,
        category: category as DisputeCategory,
        description,
        evidenceLinks,
      });

      res.status(201).json({ success: true, dispute });
    } catch (err: any) {
      if (err instanceof TradeValidationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Failed to open dispute:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * GET /api/exchange/trades/:tradeId/dispute
 * Gets latest dispute for this trade
 */
exchangeOperationsRouter.get(
  '/api/exchange/trades/:tradeId/dispute',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tradeId } = req.params;
      const dispute = await getExchangeDisputeByTradeId(tradeId);
      res.json({ success: true, dispute });
    } catch (err: any) {
      console.error('Failed to get dispute for trade:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * GET /api/exchange/trades/:tradeId/settlement
 * Gets settlement summary for a completed trade
 */
exchangeOperationsRouter.get(
  '/api/exchange/trades/:tradeId/settlement',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tradeId } = req.params;
      const settlement = await getSettlementByTradeId(tradeId);
      res.json({ success: true, settlement });
    } catch (err: any) {
      console.error('Failed to get settlement:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * GET /api/exchange/notifications
 * Lists in-app notifications for current user
 */
exchangeOperationsRouter.get(
  '/api/exchange/notifications',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const staff = isStaffOrOwner(user);

      const notifications = await prisma.exchangeNotification.findMany({
        where: {
          OR: [
            { recipientDiscordId: user.discordId },
            ...(staff ? [{ recipientRole: 'ADMIN_TEAM' }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      const unreadCount = notifications.filter((n) => !n.isRead).length;

      res.json({ success: true, notifications, unreadCount });
    } catch (err: any) {
      console.error('Failed to get exchange notifications:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * PATCH /api/exchange/notifications/:notificationId/read
 * Marks a notification as read
 */
exchangeOperationsRouter.patch(
  '/api/exchange/notifications/:notificationId/read',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { notificationId } = req.params;
      const updated = await prisma.exchangeNotification.update({
        where: { id: notificationId },
        data: { isRead: true },
      });
      res.json({ success: true, notification: updated });
    } catch (err: any) {
      console.error('Failed to mark notification read:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * POST /api/exchange/notifications/mark-all-read
 * Marks all notifications for current user as read
 */
exchangeOperationsRouter.post(
  '/api/exchange/notifications/mark-all-read',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const staff = isStaffOrOwner(user);

      await prisma.exchangeNotification.updateMany({
        where: {
          OR: [
            { recipientDiscordId: user.discordId },
            ...(staff ? [{ recipientRole: 'ADMIN_TEAM' }] : []),
          ],
          isRead: false,
        },
        data: { isRead: true },
      });

      res.json({ success: true, message: 'All notifications marked as read.' });
    } catch (err: any) {
      console.error('Failed to mark all notifications read:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PART B: ADMIN OPERATIONS WORKSPACE ENDPOINTS (/api/admin/exchange/...)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/exchange/overview
 * Returns the 9 PRD KPI Cards and operational metrics
 */
exchangeOperationsRouter.get(
  '/api/admin/exchange/overview',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const [
        settlementsAgg,
        activeEscrowAgg,
        disputedEscrowAgg,
        awaitingFinalApprovalCount,
        activeDisputesCount,
        pendingKycRequestsCount,
        activeTradesCount,
        totalCompletedTradesCount,
        recentSettlements,
      ] = await Promise.all([
        prisma.exchangeSettlement.aggregate({
          _sum: {
            grossValueCents: true,
            g4xTotalRevenueCents: true,
          },
        }),
        prisma.exchangeEscrow.aggregate({
          where: { status: 'RESERVED' },
          _sum: { reservedAmountCents: true },
        }),
        prisma.exchangeEscrow.aggregate({
          where: { status: 'FROZEN_DISPUTE' },
          _sum: { reservedAmountCents: true },
        }),
        prisma.exchangeTrade.count({
          where: { status: 'AWAITING_FINAL_APPROVAL' },
        }),
        prisma.exchangeDispute.count({
          where: { status: { in: ['OPEN', 'UNDER_REVIEW', 'AWAITING_PROOF'] } },
        }),
        prisma.exchangeKycRequest.count({
          where: { status: 'SUBMITTED' },
        }),
        prisma.exchangeTrade.count({
          where: {
            status: {
              in: [
                'PAYMENT_CONFIRMED',
                'DELIVERY_IN_PROGRESS',
                'PROOF_SUBMITTED',
                'ADDITIONAL_PROOF_REQUESTED',
                'AWAITING_FINAL_APPROVAL',
              ],
            },
          },
        }),
        prisma.exchangeTrade.count({
          where: { status: 'COMPLETED' },
        }),
        prisma.exchangeSettlement.findMany({
          orderBy: { settledAt: 'desc' },
          take: 5,
          include: {
            trade: {
              include: {
                game: true,
                currency: true,
                buyer: { select: { discordId: true, username: true } },
                seller: { select: { discordId: true, username: true } },
              },
            },
          },
        }),
      ]);

      const kpis = {
        totalCompletedTradesVolumeCents: settlementsAgg._sum.grossValueCents || 0,
        totalPlatformRevenueCents: settlementsAgg._sum.g4xTotalRevenueCents || 0,
        activeEscrowReservedCents: activeEscrowAgg._sum.reservedAmountCents || 0,
        disputedEscrowFrozenCents: disputedEscrowAgg._sum.reservedAmountCents || 0,
        awaitingFinalApprovalCount,
        activeDisputesCount,
        pendingKycRequestsCount,
        activeTradesCount,
        totalCompletedTradesCount,
      };

      res.json({
        success: true,
        kpis,
        recentSettlements,
      });
    } catch (err: any) {
      console.error('Failed to get exchange admin overview:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * GET /api/admin/exchange/approval-queue
 * Retrieves trades currently awaiting final sign-off and payout
 */
exchangeOperationsRouter.get(
  '/api/admin/exchange/approval-queue',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const queue = await prisma.exchangeTrade.findMany({
        where: { status: 'AWAITING_FINAL_APPROVAL' },
        include: {
          game: true,
          currency: true,
          deliveryMethod: true,
          escrow: true,
          proofs: { orderBy: { createdAt: 'desc' } },
          buyer: {
            select: {
              discordId: true,
              username: true,
              displayName: true,
            },
          },
          seller: {
            select: {
              discordId: true,
              username: true,
              displayName: true,
            },
          },
        },
        orderBy: { buyerConfirmedAt: 'asc' },
      });

      res.json({ success: true, queue });
    } catch (err: any) {
      console.error('Failed to get approval queue:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * POST /api/admin/exchange/trades/:tradeId/approve
 * Approves trade final payout and settles funds to seller (Idempotent)
 */
exchangeOperationsRouter.post(
  '/api/admin/exchange/trades/:tradeId/approve',
  requireAuth,
  requireOwnerOrStaff,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;
      const { note } = req.body;

      const result = await approveAndSettleExchangeTrade({
        tradeId,
        adminUserId: user.discordId,
        adminDiscordId: user.discordId,
        note,
      });

      res.json({
        success: true,
        settlement: result.settlement,
        trade: result.trade,
        message: 'Trade approved and funds settled to seller.',
      });
    } catch (err: any) {
      if (err instanceof TradeValidationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Failed to approve trade:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * POST /api/admin/exchange/trades/:tradeId/reject
 * Rejects final approval and sets trade back to ADDITIONAL_PROOF_REQUESTED
 */
exchangeOperationsRouter.post(
  '/api/admin/exchange/trades/:tradeId/reject',
  requireAuth,
  requireOwnerOrStaff,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;
      const { reason } = req.body;

      if (!reason || reason.trim().length < 5) {
        res.status(400).json({ error: 'Rejection reason must be at least 5 characters long.' });
        return;
      }

      const updatedTrade = await rejectTradeFinalApproval({
        tradeId,
        adminDiscordId: user.discordId,
        reason,
      });

      res.json({
        success: true,
        trade: updatedTrade,
        message: 'Final approval rejected. Trade reverted to additional proof requested.',
      });
    } catch (err: any) {
      if (err instanceof TradeValidationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Failed to reject final approval:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * POST /api/admin/exchange/trades/:tradeId/request-proof
 * Requests additional proof from seller
 */
exchangeOperationsRouter.post(
  '/api/admin/exchange/trades/:tradeId/request-proof',
  requireAuth,
  requireOwnerOrStaff,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;
      const { reason } = req.body;

      if (!reason || reason.trim().length < 5) {
        res.status(400).json({ error: 'Reason must be at least 5 characters long.' });
        return;
      }

      const updatedTrade = await requestAdditionalProof({
        tradeId,
        actorDiscordId: user.discordId,
        actorRole: 'ADMIN',
        reason,
      });

      res.json({ success: true, trade: updatedTrade });
    } catch (err: any) {
      if (err instanceof TradeValidationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Failed to request additional proof:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * POST /api/admin/exchange/trades/:tradeId/internal-note
 * Appends an internal admin note to a trade
 */
exchangeOperationsRouter.post(
  '/api/admin/exchange/trades/:tradeId/internal-note',
  requireAuth,
  requireOwnerOrStaff,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;
      const { note } = req.body;

      if (!note || note.trim().length === 0) {
        res.status(400).json({ error: 'Note cannot be empty.' });
        return;
      }

      const updatedTrade = await addTradeInternalNote({
        tradeId,
        adminDiscordId: user.discordId,
        note,
      });

      res.json({ success: true, trade: updatedTrade });
    } catch (err: any) {
      if (err instanceof TradeValidationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Failed to add internal note:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * GET /api/admin/exchange/trades
 * Lists all exchange trades with filters and pagination
 */
exchangeOperationsRouter.get(
  '/api/admin/exchange/trades',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
      const status = req.query.status as string;
      const gameId = req.query.gameId as string;
      const search = req.query.search as string;

      const where: any = {};
      if (status && status !== 'ALL') where.status = status;
      if (gameId && gameId !== 'ALL') where.gameId = gameId;
      if (search && search.trim()) {
        where.OR = [
          { tradeCode: { contains: search.trim() } },
          { buyerDiscordId: { contains: search.trim() } },
          { sellerDiscordId: { contains: search.trim() } },
        ];
      }

      const [trades, total] = await Promise.all([
        prisma.exchangeTrade.findMany({
          where,
          include: {
            game: true,
            currency: true,
            deliveryMethod: true,
            escrow: true,
            settlement: true,
            buyer: { select: { discordId: true, username: true } },
            seller: { select: { discordId: true, username: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.exchangeTrade.count({ where }),
      ]);

      res.json({
        success: true,
        trades,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err: any) {
      console.error('Failed to list admin trades:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * GET /api/admin/exchange/disputes
 * Lists disputes with pagination and filtering
 */
exchangeOperationsRouter.get(
  '/api/admin/exchange/disputes',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const status = req.query.status as string;
      const category = req.query.category as string;
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;

      const result = await listExchangeDisputes({
        status: status && status !== 'ALL' ? status : undefined,
        category: category && category !== 'ALL' ? category : undefined,
        page,
        limit,
      });

      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('Failed to list disputes:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * GET /api/admin/exchange/disputes/:disputeId
 * Retrieves detailed dispute information
 */
exchangeOperationsRouter.get(
  '/api/admin/exchange/disputes/:disputeId',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { disputeId } = req.params;
      const dispute = await getExchangeDisputeById(disputeId);
      if (!dispute) {
        res.status(404).json({ error: 'Dispute not found' });
        return;
      }
      res.json({ success: true, dispute });
    } catch (err: any) {
      console.error('Failed to get dispute by ID:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * POST /api/admin/exchange/disputes/:disputeId/resolve
 * Resolves an active dispute with one of the 5 PRD outcomes
 */
exchangeOperationsRouter.post(
  '/api/admin/exchange/disputes/:disputeId/resolve',
  requireAuth,
  requireOwnerOrStaff,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { disputeId } = req.params;
      const { outcome, buyerRefundCents, sellerPayoutCents, note } = req.body;

      const resolved = await resolveExchangeDispute({
        disputeId,
        adminUserId: user.discordId,
        adminDiscordId: user.discordId,
        outcome: outcome as DisputeResolutionOutcome,
        buyerRefundCents: buyerRefundCents !== undefined ? parseInt(buyerRefundCents, 10) : undefined,
        sellerPayoutCents: sellerPayoutCents !== undefined ? parseInt(sellerPayoutCents, 10) : undefined,
        note,
      });

      res.json({
        success: true,
        dispute: resolved,
        message: `Dispute resolved with outcome: ${outcome}`,
      });
    } catch (err: any) {
      if (err instanceof TradeValidationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Failed to resolve dispute:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * GET /api/admin/exchange/settlements
 * Lists all settled transactions
 */
exchangeOperationsRouter.get(
  '/api/admin/exchange/settlements',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));

      const [settlements, total] = await Promise.all([
        prisma.exchangeSettlement.findMany({
          include: {
            trade: {
              include: {
                game: true,
                currency: true,
                buyer: { select: { discordId: true, username: true } },
                seller: { select: { discordId: true, username: true } },
              },
            },
          },
          orderBy: { settledAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.exchangeSettlement.count(),
      ]);

      res.json({
        success: true,
        settlements,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err: any) {
      console.error('Failed to list settlements:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * GET /api/admin/exchange/exchangers
 * Lists exchanger users with KYC details and activity stats
 */
exchangeOperationsRouter.get(
  '/api/admin/exchange/exchangers',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const exchangers = await prisma.user.findMany({
        where: {
          OR: [
            { userRoles: { some: { roleKey: 'exchanger' } } },
            { exchangePermission: { isNot: null } },
            { exchangeKyc: { isNot: null } },
          ],
        },
        include: {
          userRoles: true,
          exchangePermission: true,
          exchangeKyc: true,
          exchangeTradesAsSeller: {
            select: {
              id: true,
              status: true,
              grossValueCents: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const formatted = exchangers.map((u) => {
        const completedTrades = (u.exchangeTradesAsSeller || []).filter((t: any) => t.status === 'COMPLETED');
        const totalVolumeCents = completedTrades.reduce((acc: number, t: any) => acc + t.grossValueCents, 0);

        return {
          discordId: u.discordId,
          username: u.username,
          displayName: u.displayName,
          roles: (u.userRoles || []).map((r: any) => r.roleKey),
          permissions: u.exchangePermission,
          latestKyc: u.exchangeKyc || null,
          completedTradesCount: completedTrades.length,
          totalVolumeCents,
        };
      });

      res.json({ success: true, exchangers: formatted });
    } catch (err: any) {
      console.error('Failed to list exchangers:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);

/**
 * GET /api/admin/exchange/audit-logs
 * Retrieves immutable audit logs for Exchange actions
 */
exchangeOperationsRouter.get(
  '/api/admin/exchange/audit-logs',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 30));

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: {
            entityType: { startsWith: 'Exchange' },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.auditLog.count({
          where: {
            entityType: { startsWith: 'Exchange' },
          },
        }),
      ]);

      res.json({
        success: true,
        logs,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err: any) {
      console.error('Failed to get exchange audit logs:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }
);
