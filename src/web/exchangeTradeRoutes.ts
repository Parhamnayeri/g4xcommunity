/**
 * src/web/exchangeTradeRoutes.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 4:
 * Seller Offer Submission, Buyer Acceptance, Partial Fulfillment,
 * Trade Creation, Event Timelines, and Trade Cancellation.
 */

import { Router, Request, Response } from 'express';
import { requireAuth, requireCsrf, AuthenticatedRequest } from './middleware/auth';
import {
  previewSellOfferPricing,
  submitSellOffer,
  acceptSellOffer,
  rejectSellOffer,
  withdrawSellOffer,
  cancelUnpaidTrade,
  listOffersOnBuyOrder,
  listMySellOffers,
  listTrades,
  getTradeById,
  ConcurrencyConflictError,
  TradeValidationError,
} from '../services/exchangeTradeService';
import { ExchangeAuthError } from '../services/exchangeAuthService';

export const exchangeTradeRouter = Router();

function getUserRoles(user: any): string[] {
  if (!user || !user.userRoles) return [];
  return user.userRoles.map((r: any) => r.roleKey.toLowerCase());
}

/**
 * POST /api/exchange/orders/:orderId/offers/preview
 * Previews financial breakdown, fees, and net payout for an intended sell offer amount
 */
exchangeTradeRouter.post(
  '/api/exchange/orders/:orderId/offers/preview',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { orderId } = req.params;
      const { offeredAmountBaseUnits } = req.body;

      if (!offeredAmountBaseUnits) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'offeredAmountBaseUnits is required for preview.',
        });
        return;
      }

      const preview = await previewSellOfferPricing({
        buyOrderId: orderId,
        offeredAmountBaseUnits: String(offeredAmountBaseUnits),
      });

      res.json({
        success: true,
        preview,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: 'Validation Error', message: error.message });
        return;
      }
      console.error('Failed to preview sell offer pricing:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * POST /api/exchange/orders/:orderId/offers
 * Submits a new sell offer to an active buy order.
 * Strictly checks seller roles, anti-self-trading, and order limits.
 */
exchangeTradeRouter.post(
  '/api/exchange/orders/:orderId/offers',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { orderId } = req.params;
      const {
        offeredAmountBaseUnits,
        deliveryMethodId,
        estimatedDeliveryMinutes,
        additionalInfo,
      } = req.body;

      if (!offeredAmountBaseUnits || !deliveryMethodId) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'offeredAmountBaseUnits and deliveryMethodId are required.',
        });
        return;
      }

      const offer = await submitSellOffer({
        buyOrderId: orderId,
        sellerUserId: user.discordId,
        offeredAmountBaseUnits: String(offeredAmountBaseUnits),
        deliveryMethodId: String(deliveryMethodId),
        estimatedDeliveryMinutes: estimatedDeliveryMinutes ? Number(estimatedDeliveryMinutes) : undefined,
        additionalInfo: additionalInfo ? String(additionalInfo) : undefined,
      });

      res.status(201).json({
        success: true,
        message: 'Sell offer submitted successfully.',
        offer,
      });
    } catch (error: any) {
      if (error instanceof ExchangeAuthError) {
        res.status(error.statusCode).json({
          error: 'Forbidden',
          message: error.message,
          reasons: error.reasons,
        });
        return;
      }
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: 'Validation Error', message: error.message });
        return;
      }
      console.error('Failed to submit sell offer:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * GET /api/exchange/orders/:orderId/offers
 * Lists all sell offers submitted on a buy order.
 * Accessible only by the buyer, staff, or owner.
 */
exchangeTradeRouter.get(
  '/api/exchange/orders/:orderId/offers',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { orderId } = req.params;
      const roles = getUserRoles(user);

      const offers = await listOffersOnBuyOrder(orderId, user.discordId, roles);
      res.json({
        success: true,
        offers,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: 'Error', message: error.message });
        return;
      }
      console.error('Failed to list offers on buy order:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * GET /api/exchange/my-sell-offers
 * Lists all sell offers submitted by the current authenticated seller.
 */
exchangeTradeRouter.get(
  '/api/exchange/my-sell-offers',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const offers = await listMySellOffers(user.discordId);
      res.json({
        success: true,
        offers,
      });
    } catch (error: any) {
      console.error('Failed to list user sell offers:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * POST /api/exchange/offers/:offerId/accept
 * Buyer accepts a pending sell offer.
 * Atomically reserves capacity, snapshots fee rules, and creates an Exchange Trade.
 * Concurrency protected.
 */
exchangeTradeRouter.post(
  '/api/exchange/offers/:offerId/accept',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { offerId } = req.params;
      const roles = getUserRoles(user);
      const isStaffOrOwner =
        roles.includes('admin') || roles.includes('owner') || roles.includes('staff');

      const trade = await acceptSellOffer({
        offerId,
        buyerUserId: user.discordId,
        isStaffOrOwner,
      });

      res.status(201).json({
        success: true,
        message: 'Sell offer accepted and trade created successfully.',
        trade,
      });
    } catch (error: any) {
      if (error instanceof ConcurrencyConflictError) {
        res.status(409).json({
          error: 'Conflict',
          message: error.message,
        });
        return;
      }
      if (error instanceof ExchangeAuthError) {
        res.status(error.statusCode).json({
          error: 'Forbidden',
          message: error.message,
          reasons: error.reasons,
        });
        return;
      }
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: 'Validation Error', message: error.message });
        return;
      }
      console.error('Failed to accept sell offer:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * POST /api/exchange/offers/:offerId/reject
 * Buyer rejects a pending sell offer.
 */
exchangeTradeRouter.post(
  '/api/exchange/offers/:offerId/reject',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { offerId } = req.params;
      const { reason } = req.body;
      const roles = getUserRoles(user);
      const isStaffOrOwner =
        roles.includes('admin') || roles.includes('owner') || roles.includes('staff');

      const offer = await rejectSellOffer({
        offerId,
        buyerUserId: user.discordId,
        reason: reason ? String(reason) : undefined,
        isStaffOrOwner,
      });

      res.json({
        success: true,
        message: 'Sell offer rejected.',
        offer,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: 'Error', message: error.message });
        return;
      }
      console.error('Failed to reject sell offer:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * POST /api/exchange/offers/:offerId/withdraw
 * Seller withdraws their own pending sell offer.
 */
exchangeTradeRouter.post(
  '/api/exchange/offers/:offerId/withdraw',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { offerId } = req.params;
      const roles = getUserRoles(user);
      const isStaffOrOwner =
        roles.includes('admin') || roles.includes('owner') || roles.includes('staff');

      const offer = await withdrawSellOffer({
        offerId,
        sellerUserId: user.discordId,
        isStaffOrOwner,
      });

      res.json({
        success: true,
        message: 'Sell offer withdrawn.',
        offer,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: 'Error', message: error.message });
        return;
      }
      console.error('Failed to withdraw sell offer:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * GET /api/exchange/trades
 * Lists trades for the authenticated user (as buyer or seller).
 */
exchangeTradeRouter.get(
  '/api/exchange/trades',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { role, status } = req.query;

      const trades = await listTrades({
        userId: user.discordId,
        role: role === 'buyer' || role === 'seller' ? role : undefined,
        status: typeof status === 'string' ? status : undefined,
      });

      res.json({
        success: true,
        trades,
      });
    } catch (error: any) {
      console.error('Failed to list trades:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * GET /api/exchange/trades/:tradeId
 * Returns full trade details with immutable fee/price snapshots and event timeline.
 */
exchangeTradeRouter.get(
  '/api/exchange/trades/:tradeId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;
      const roles = getUserRoles(user);

      const trade = await getTradeById(tradeId, user.discordId, roles);

      res.json({
        success: true,
        trade,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: 'Error', message: error.message });
        return;
      }
      console.error('Failed to get trade by id:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * POST /api/exchange/trades/:tradeId/cancel
 * Cancels an unpaid trade (AWAITING_PAYMENT), safely releases reserved capacity
 * back to the buy order, and restores buy order status.
 */
exchangeTradeRouter.post(
  '/api/exchange/trades/:tradeId/cancel',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;
      const { reason } = req.body;
      const roles = getUserRoles(user);

      const cancelledTrade = await cancelUnpaidTrade({
        tradeId,
        actorUserId: user.discordId,
        actorRoles: roles,
        reason: reason ? String(reason) : undefined,
      });

      res.json({
        success: true,
        message: 'Trade cancelled and capacity released back to buy order.',
        trade: cancelledTrade,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: 'Error', message: error.message });
        return;
      }
      console.error('Failed to cancel trade:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);
