/**
 * marketplaceRoutes.ts — روت‌های امن Express برای بازار مبادلات صرافی، معاملات طلا و شارژ P2P
 *
 * ویژگی‌های امنیتی:
 *  - احراز هویت متمرکز مبتنی بر سشن سرور (requireAuth)
 *  - کنترل دسترسی نقش‌ها (requireRole)
 *  - حفاظت CSRF بر روی تمامی متدهای تغییردهنده حالت (requireCsrf)
 *  - عدم اعتماد به شناسه کاربر، نرخ‌ها یا کارمزدهای ارسالی کلاینت
 */

import { Router, Request, Response } from 'express';
import {
  requireAuth,
  requireRole,
  requireCsrf,
  AuthenticatedRequest,
} from './middleware/auth';
import prisma from '../database/db';
import {
  createExchangerFeeOffer,
  updateExchangerFeeOffer,
  setExchangerOfferStatus,
  getActiveExchangerOffers,
  generateGoldTradeQuote,
  createGoldTradeOrder,
  acceptGoldTrade,
  reportGoldDelivery,
  verifyGoldDelivery,
  submitExternalTradePayment,
  confirmExternalPaymentReceipt,
  settleDirectGoldTrade,
  settlePrepaidWalletGoldTrade,
  cancelGoldTrade,
  disputeGoldTrade,
  generateP2pFundingQuote,
  acceptP2pFundingRequest,
  settleP2pFunding,
} from '../services/financeV2/exchangerMarketplaceService';
import {
  ExchangerOfferStatus,
  GoldTradeSettlementMethod,
} from '../services/financeV2/financeV2Types';
import { mapGoldTradeStatus, mapApplicationStatus } from '../services/statusSimplifier';
import { getWalletV2Summary } from '../services/financeV2/financeV2WalletService';

export const marketplaceRouter = Router();

// ─── ۱. روت‌های عمومی/کاربری لیست پیشنهادهای فعال ────────────────────────────
marketplaceRouter.get('/offers', async (req: Request, res: Response): Promise<void> => {
  try {
    const { serviceType, currency, page, limit, sortOrder } = req.query;
    const allOffers = await getActiveExchangerOffers(
      typeof serviceType === 'string' ? serviceType : undefined,
      typeof currency === 'string' ? currency : undefined
    );

    const isDesc = sortOrder === 'desc';
    const sortedOffers = [...allOffers].sort((a, b) =>
      isDesc ? b.commissionPercentage - a.commissionPercentage : a.commissionPercentage - b.commissionPercentage
    );

    if (page || limit) {
      const pageNum = Math.max(1, parseInt(String(page || 1), 10) || 1);
      const limitNum = Math.min(50, Math.max(1, parseInt(String(limit || 20), 10) || 20));
      const skip = (pageNum - 1) * limitNum;
      const paginatedOffers = sortedOffers.slice(skip, skip + limitNum);

      res.json({
        success: true,
        offers: paginatedOffers,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: sortedOffers.length,
          totalPages: Math.ceil(sortedOffers.length / limitNum) || 1,
        },
      });
      return;
    }

    res.json({
      success: true,
      offers: sortedOffers,
      pagination: {
        page: 1,
        limit: sortedOffers.length,
        total: sortedOffers.length,
        totalPages: 1,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch offers' });
  }
});

marketplaceRouter.get('/offers/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const offer = await prisma.exchangerFeeOffer.findUnique({
      where: { id },
      include: {
        exchanger: {
          select: { discordId: true, username: true, displayName: true },
        },
      },
    });
    if (!offer) {
      res.status(404).json({ error: 'Offer not found' });
      return;
    }
    res.json({ success: true, offer });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ۲. روت‌های اختصاصی صراف (Exchanger Routes) ─────────────────────────────
marketplaceRouter.get(
  '/exchanger/status',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const userRoles = (user.userRoles || []).map((r: { roleKey: string }) => r.roleKey);
      const isOwner =
        userRoles.includes('owner') ||
        (Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId);
      const isExchanger = userRoles.includes('exchanger');

      if (isExchanger || isOwner) {
        res.json({
          success: true,
          isApproved: true,
          role: isOwner ? 'owner' : 'exchanger',
          application: null,
        });
        return;
      }

      // بررسی درخواست ثبت‌نام صراف در صورت عدم تایید هنوز
      const activeApp = await prisma.registrationApplication.findFirst({
        where: {
          userId: user.discordId,
          category: 'exchanger',
        },
        orderBy: { submittedAt: 'desc' },
      });

      res.json({
        success: true,
        isApproved: false,
        role: null,
        application: activeApp
          ? {
              id: activeApp.id,
              category: activeApp.category,
              status: activeApp.status,
              simplifiedStatus: mapApplicationStatus(activeApp.status),
              submittedAt: activeApp.submittedAt,
              rejectionReason: activeApp.rejectionReason,
              reviewNotes: activeApp.reviewNotes,
            }
          : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to check exchanger status' });
    }
  }
);

marketplaceRouter.get(
  '/exchanger/overview',
  requireAuth,
  requireRole('exchanger', 'owner'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const [walletSummary, activeOffersCount, allTrades] = await Promise.all([
        getWalletV2Summary(user.discordId),
        prisma.exchangerFeeOffer.count({
          where: { exchangerId: user.discordId, status: ExchangerOfferStatus.ACTIVE },
        }),
        prisma.goldTrade.findMany({
          where: { buyerId: user.discordId },
          select: {
            tradeStatus: true,
            goldDeliveryStatus: true,
            paymentStatus: true,
            agreedValuationUsdCents: true,
          },
        }),
      ]);

      const totalTradesCount = allTrades.length;
      const pendingDeliveryCount = allTrades.filter(
        (t) => t.goldDeliveryStatus === 'PENDING' && t.tradeStatus !== 'CANCELLED' && t.tradeStatus !== 'REJECTED'
      ).length;
      const pendingPaymentCount = allTrades.filter(
        (t) =>
          (t.paymentStatus === 'PENDING' || t.paymentStatus === 'SUBMITTED') &&
          t.tradeStatus !== 'CANCELLED' &&
          t.tradeStatus !== 'REJECTED' &&
          t.tradeStatus !== 'SETTLED'
      ).length;
      const settledTrades = allTrades.filter((t) => t.tradeStatus === 'SETTLED');
      const settledTradesCount = settledTrades.length;
      const settledVolumeUsdCents = settledTrades.reduce((sum, t) => sum + (t.agreedValuationUsdCents || 0), 0);

      const p2pSettlementEnabled = process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED === 'true';

      res.json({
        success: true,
        profile: {
          discordId: user.discordId,
          username: user.username,
          displayName: user.displayName || user.username,
        },
        wallet: {
          availableCents: walletSummary.availableCents,
          availableUsd: (walletSummary.availableCents / 100).toFixed(2),
          reservedCents: walletSummary.reservedCents,
          reservedUsd: (walletSummary.reservedCents / 100).toFixed(2),
        },
        metrics: {
          activeOffersCount,
          totalTradesCount,
          pendingDeliveryCount,
          pendingPaymentCount,
          settledTradesCount,
          settledVolumeUsdCents,
          settledVolumeUsd: (settledVolumeUsdCents / 100).toFixed(2),
        },
        featureGates: {
          p2pSettlementEnabled,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch exchanger overview' });
    }
  }
);

marketplaceRouter.get(
  '/exchanger/offers',
  requireAuth,
  requireRole('exchanger', 'owner'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const offers = await prisma.exchangerFeeOffer.findMany({
        where: { exchangerId: user.discordId },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ success: true, offers });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/exchanger/offers',
  requireAuth,
  requireRole('exchanger', 'owner'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const {
        serviceType,
        settlementCurrency,
        commissionPercentage,
        feeCalculationBasis,
        feePayer,
        minAmount,
        maxAmount,
        terms,
      } = req.body;

      const offer = await createExchangerFeeOffer(user.discordId, {
        exchangerId: user.discordId,
        serviceType,
        settlementCurrency,
        commissionPercentage: Number(commissionPercentage),
        feeCalculationBasis,
        feePayer,
        minAmount: minAmount !== undefined ? Number(minAmount) : undefined,
        maxAmount: maxAmount !== undefined ? Number(maxAmount) : undefined,
        terms,
      });

      res.status(201).json({ success: true, offer });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.patch(
  '/exchanger/offers/:id',
  requireAuth,
  requireRole('exchanger', 'owner'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);
      const { commissionPercentage, minAmount, maxAmount, terms, status } = req.body;

      const updated = await updateExchangerFeeOffer(user.discordId, id, {
        commissionPercentage: commissionPercentage !== undefined ? Number(commissionPercentage) : undefined,
        minAmount: minAmount !== undefined ? Number(minAmount) : undefined,
        maxAmount: maxAmount !== undefined ? Number(maxAmount) : undefined,
        terms,
        status,
      });

      res.json({ success: true, offer: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.get(
  '/exchanger/trades',
  requireAuth,
  requireRole('exchanger', 'owner'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { status, settlementMethod, page, limit, sortOrder } = req.query;

      const whereClause: any = { buyerId: user.discordId };
      if (typeof status === 'string' && status.trim()) {
        whereClause.tradeStatus = status.trim();
      }
      if (typeof settlementMethod === 'string' && settlementMethod.trim()) {
        whereClause.settlementMethod = settlementMethod.trim();
      }

      const total = await prisma.goldTrade.count({ where: whereClause });
      const pageNum = Math.max(1, parseInt(String(page || 1), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit || 50), 10) || 50));
      const skip = (pageNum - 1) * limitNum;
      const isAsc = sortOrder === 'asc';

      const trades = await prisma.goldTrade.findMany({
        where: whereClause,
        include: {
          seller: { select: { discordId: true, username: true, displayName: true } },
        },
        orderBy: { createdAt: isAsc ? 'asc' : 'desc' },
        skip,
        take: limitNum,
      });

      res.json({
        success: true,
        trades: trades.map((t) => ({
          ...t,
          simplifiedStatus: mapGoldTradeStatus(t.tradeStatus),
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/exchanger/trades/:id/payment',
  requireAuth,
  requireRole('exchanger', 'owner'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);
      const { paymentRef, paymentMethod, amount } = req.body;

      const trade = await submitExternalTradePayment(
        id,
        user.discordId,
        paymentRef,
        paymentMethod,
        amount
      );

      res.json({ success: true, trade });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/exchanger/trades/:id/verify-gold',
  requireAuth,
  requireRole('exchanger', 'owner'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);

      const trade = await verifyGoldDelivery(id, user.discordId);
      res.json({ success: true, trade });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// ─── ۳. روت‌های فروشنده طلا و متقاضی شارژ (Advertiser Routes) ────────────────
marketplaceRouter.post(
  '/advertiser/trades/quote',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const {
        buyerId,
        offerId,
        gameSlug,
        region,
        realm,
        faction,
        goldQuantity,
        agreedValuationUsdCents,
        settlementMethod,
      } = req.body;

      const quote = await generateGoldTradeQuote({
        sellerId: user.discordId,
        buyerId,
        offerId: offerId ? Number(offerId) : undefined,
        gameSlug: gameSlug || 'wow_midnight',
        region,
        realm,
        faction,
        goldQuantity: Number(goldQuantity),
        agreedValuationUsdCents: Number(agreedValuationUsdCents),
        settlementMethod,
      });

      res.json({ success: true, quote });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/advertiser/trades/accept',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { quote } = req.body;

      if (!quote || quote.sellerId !== user.discordId) {
        res.status(400).json({ error: 'Invalid quote or quote seller mismatch' });
        return;
      }

      // ایجاد رکورد معامله در دیتابیس
      const trade = await createGoldTradeOrder(quote);
      // پذیرش و اجرای رزرو وجه در صورت نیاز
      const accepted = await acceptGoldTrade(trade.id, user.discordId);

      res.status(201).json({ success: true, trade: accepted });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.get(
  '/advertiser/trades',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { status, settlementMethod, page, limit, sortOrder } = req.query;

      const whereClause: any = { sellerId: user.discordId };
      if (typeof status === 'string' && status.trim()) {
        whereClause.tradeStatus = status.trim();
      }
      if (typeof settlementMethod === 'string' && settlementMethod.trim()) {
        whereClause.settlementMethod = settlementMethod.trim();
      }

      const total = await prisma.goldTrade.count({ where: whereClause });
      const pageNum = Math.max(1, parseInt(String(page || 1), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit || 50), 10) || 50));
      const skip = (pageNum - 1) * limitNum;
      const isAsc = sortOrder === 'asc';

      const trades = await prisma.goldTrade.findMany({
        where: whereClause,
        include: {
          buyer: { select: { discordId: true, username: true, displayName: true } },
        },
        orderBy: { createdAt: isAsc ? 'asc' : 'desc' },
        skip,
        take: limitNum,
      });

      res.json({
        success: true,
        trades: trades.map((t) => ({
          ...t,
          simplifiedStatus: mapGoldTradeStatus(t.tradeStatus),
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/advertiser/trades/:id/delivery',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);
      const { deliveryEvidenceRef } = req.body;

      const trade = await reportGoldDelivery(id, user.discordId, deliveryEvidenceRef);
      res.json({ success: true, trade });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/advertiser/trades/:id/confirm-payment',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);

      const trade = await confirmExternalPaymentReceipt(id, user.discordId);
      res.json({ success: true, trade });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/advertiser/trades/:id/dispute',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);
      const { reason } = req.body;

      const trade = await disputeGoldTrade(id, user.discordId, reason || 'Disputed by advertiser');
      res.json({ success: true, trade });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/trades/:id/cancel',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);
      const { reason } = req.body;

      const trade = await cancelGoldTrade(id, user.discordId, reason || 'Cancelled by trade participant');
      res.json({ success: true, trade });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/advertiser/p2p-funding/quote',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { exchangerId, offerId, targetUsdCents } = req.body;

      const quote = await generateP2pFundingQuote({
        advertiserId: user.discordId,
        exchangerId,
        offerId: Number(offerId),
        targetUsdCents: Number(targetUsdCents),
      });

      res.json({ success: true, quote });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/advertiser/p2p-funding/accept',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { quote } = req.body;

      if (!quote || quote.advertiserId !== user.discordId) {
        res.status(400).json({ error: 'Quote mismatch' });
        return;
      }

      const fundingRequest = await acceptP2pFundingRequest(user.discordId, quote);
      res.status(201).json({ success: true, fundingRequest });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// ─── ۴. روت‌های مدیریتی بازار (Admin Marketplace Review) ────────────────────
marketplaceRouter.get(
  '/admin/trades',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const trades = await prisma.goldTrade.findMany({
        include: {
          seller: { select: { discordId: true, username: true, displayName: true } },
          buyer: { select: { discordId: true, username: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json({ success: true, trades });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/admin/trades/:id/settle-direct',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);

      const trade = await settleDirectGoldTrade(id, user.discordId);
      res.json({ success: true, trade });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/admin/trades/:id/settle-prepaid',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);

      const trade = await settlePrepaidWalletGoldTrade(id, user.discordId);
      res.json({ success: true, trade });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/admin/trades/:id/cancel',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);
      const { reason } = req.body;

      const trade = await cancelGoldTrade(id, user.discordId, reason);
      res.json({ success: true, trade });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

marketplaceRouter.post(
  '/admin/offers/:id/status',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);
      const { status, reason } = req.body;

      const offer = await setExchangerOfferStatus(
        user.discordId,
        id,
        status as ExchangerOfferStatus,
        reason
      );
      res.json({ success: true, offer });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);
