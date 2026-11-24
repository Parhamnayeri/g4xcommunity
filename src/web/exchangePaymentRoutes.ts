/**
 * src/web/exchangePaymentRoutes.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 5:
 * Buyer Checkout, Payment Processing (Wallet, NOWPayments Crypto, Bank Transfer),
 * Escrow Funding, Admin Verification, and Refund Controls.
 */

import { Router, Request, Response } from 'express';
import { requireAuth, requireCsrf, AuthenticatedRequest } from './middleware/auth';
import prisma from '../database/db';
import {
  getTradeCheckoutSummary,
  payTradeWithWallet,
  initiateTradeNowPayments,
  initiateTradeBankTransfer,
  submitBankReceipt,
  approveBankTransferPayment,
  rejectBankTransferPayment,
  syncTradeNowPaymentsStatus,
  cancelExchangeTradeWithEscrowCheck,
} from '../services/exchangePaymentService';
import { TradeValidationError } from './../services/exchangeTradeService';

export const exchangePaymentRouter = Router();

function getUserRoles(user: any): string[] {
  if (!user || !user.userRoles) return [];
  return user.userRoles.map((r: any) => r.roleKey.toLowerCase());
}

function assertAdminOrOwner(user: any): void {
  const roles = getUserRoles(user);
  const isOwner = roles.includes('owner') || (Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId);
  if (!isOwner && !roles.includes('admin') && !roles.includes('staff')) {
    throw new TradeValidationError('Forbidden: Administrative privileges required.', 403);
  }
}

/**
 * GET /api/exchange/trades/:tradeId/checkout
 * Retrieves complete checkout calculation, available gateways, and live wallet balances
 */
exchangePaymentRouter.get(
  '/api/exchange/trades/:tradeId/checkout',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;
      const roles = getUserRoles(user);

      const summary = await getTradeCheckoutSummary(tradeId, user.discordId, roles);
      res.json({
        success: true,
        ...summary,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: error.name, message: error.message });
        return;
      }
      console.error('[ExchangePayment] Checkout retrieval error:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * POST /api/exchange/trades/:tradeId/pay/wallet
 * Pays trade using buyer's unified central G4X wallet balance (immediate escrow lock)
 */
exchangePaymentRouter.post(
  '/api/exchange/trades/:tradeId/pay/wallet',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;

      const result = await payTradeWithWallet(tradeId, user.discordId);
      res.json({
        success: true,
        message: 'Payment completed successfully. Funds secured in Escrow.',
        ...result,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: error.name, message: error.message });
        return;
      }
      console.error('[ExchangePayment] Wallet payment error:', error);
      res.status(500).json({ error: 'Payment Failed', message: error.message });
    }
  }
);

/**
 * POST /api/exchange/trades/:tradeId/pay/nowpayments
 * Initiates NOWPayments hosted crypto invoice for trade
 */
exchangePaymentRouter.post(
  '/api/exchange/trades/:tradeId/pay/nowpayments',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;
      const { payCurrency } = req.body;

      const result = await initiateTradeNowPayments(tradeId, user.discordId, payCurrency);
      res.json({
        success: true,
        message: 'Crypto payment initiated.',
        ...result,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: error.name, message: error.message });
        return;
      }
      console.error('[ExchangePayment] NOWPayments initiation error:', error);
      res.status(500).json({ error: 'NOWPayments Error', message: error.message });
    }
  }
);

/**
 * POST /api/exchange/trades/:tradeId/pay/bank-transfer
 * Initiates Bank Transfer / کارت به کارت checkout
 */
exchangePaymentRouter.post(
  '/api/exchange/trades/:tradeId/pay/bank-transfer',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { tradeId } = req.params;

      const result = await initiateTradeBankTransfer(tradeId, user.discordId);
      res.json({
        success: true,
        message: 'Bank transfer initiated.',
        ...result,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: error.name, message: error.message });
        return;
      }
      console.error('[ExchangePayment] Bank transfer initiation error:', error);
      res.status(500).json({ error: 'Bank Transfer Error', message: error.message });
    }
  }
);

/**
 * POST /api/exchange/payments/:paymentId/bank-receipt
 * Submits receipt reference and proof for bank transfer payment (moves to PENDING_REVIEW)
 */
exchangePaymentRouter.post(
  '/api/exchange/payments/:paymentId/bank-receipt',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { paymentId } = req.params;
      const { bankReference, receiptUrl, senderNote } = req.body;

      const payment = await submitBankReceipt(paymentId, user.discordId, {
        bankReference,
        receiptUrl,
        senderNote,
      });

      res.json({
        success: true,
        message: 'Receipt submitted for verification. Staff will review shortly.',
        payment,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: error.name, message: error.message });
        return;
      }
      console.error('[ExchangePayment] Receipt submission error:', error);
      res.status(500).json({ error: 'Receipt Submission Error', message: error.message });
    }
  }
);

/**
 * GET /api/admin/exchange/payments
 * Lists all exchange payments with filtering for Admin / Owner
 */
exchangePaymentRouter.get(
  '/api/admin/exchange/payments',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      assertAdminOrOwner(user);

      const { tradeId, status, method, limit = 50, offset = 0 } = req.query;

      const where: any = {};
      if (tradeId) where.tradeId = String(tradeId);
      if (status) where.status = String(status);
      if (method) where.method = String(method);

      const [payments, totalCount] = await Promise.all([
        prisma.exchangePayment.findMany({
          where,
          include: {
            trade: {
              include: {
                game: true,
                currency: true,
              },
            },
            buyer: {
              select: {
                discordId: true,
                username: true,
                displayName: true,
              },
            },
            escrow: true,
          },
          orderBy: { createdAt: 'desc' },
          take: Number(limit),
          skip: Number(offset),
        }),
        prisma.exchangePayment.count({ where }),
      ]);

      res.json({
        success: true,
        payments,
        totalCount,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: error.name, message: error.message });
        return;
      }
      console.error('[ExchangePayment] Admin payments list error:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * POST /api/admin/exchange/payments/:paymentId/approve-bank
 * Admin approves Bank Transfer payment: confirms payment and funds escrow
 */
exchangePaymentRouter.post(
  '/api/admin/exchange/payments/:paymentId/approve-bank',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      assertAdminOrOwner(user);

      const { paymentId } = req.params;
      const { reviewNote } = req.body;

      const result = await approveBankTransferPayment(paymentId, user.discordId, reviewNote);
      res.json({
        success: true,
        message: 'Bank transfer payment approved. Escrow is now funded.',
        ...result,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: error.name, message: error.message });
        return;
      }
      console.error('[ExchangePayment] Bank payment approval error:', error);
      res.status(500).json({ error: 'Approval Failed', message: error.message });
    }
  }
);

/**
 * POST /api/admin/exchange/payments/:paymentId/reject-bank
 * Admin rejects Bank Transfer payment
 */
exchangePaymentRouter.post(
  '/api/admin/exchange/payments/:paymentId/reject-bank',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      assertAdminOrOwner(user);

      const { paymentId } = req.params;
      const { reason } = req.body;

      const payment = await rejectBankTransferPayment(paymentId, user.discordId, reason);
      res.json({
        success: true,
        message: 'Bank transfer payment rejected.',
        payment,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: error.name, message: error.message });
        return;
      }
      console.error('[ExchangePayment] Bank payment rejection error:', error);
      res.status(500).json({ error: 'Rejection Failed', message: error.message });
    }
  }
);

/**
 * POST /api/admin/exchange/payments/:paymentId/sync-nowpayments
 * Admin forces live synchronization with NOWPayments API
 */
exchangePaymentRouter.post(
  '/api/admin/exchange/payments/:paymentId/sync-nowpayments',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      assertAdminOrOwner(user);

      const { paymentId } = req.params;
      const result = await syncTradeNowPaymentsStatus(paymentId);

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: error.name, message: error.message });
        return;
      }
      console.error('[ExchangePayment] NOWPayments sync error:', error);
      res.status(500).json({ error: 'Sync Failed', message: error.message });
    }
  }
);

/**
 * POST /api/admin/exchange/trades/:tradeId/cancel-refund
 * Admin cancels trade and refunds escrowed funds back to the buyer
 */
exchangePaymentRouter.post(
  '/api/admin/exchange/trades/:tradeId/cancel-refund',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const roles = getUserRoles(user);
      const { tradeId } = req.params;
      const { reason } = req.body;

      const trade = await cancelExchangeTradeWithEscrowCheck({
        tradeId,
        actorUserId: user.discordId,
        actorRoles: roles,
        reason,
      });

      res.json({
        success: true,
        message: 'Trade cancelled and funds refunded successfully.',
        trade,
      });
    } catch (error: any) {
      if (error instanceof TradeValidationError) {
        res.status(error.statusCode).json({ error: error.name, message: error.message });
        return;
      }
      console.error('[ExchangePayment] Trade cancel & refund error:', error);
      res.status(500).json({ error: 'Cancel & Refund Failed', message: error.message });
    }
  }
);
