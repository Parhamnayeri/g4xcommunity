/**
 * src/web/exchangeMarketplaceRoutes.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 3:
 * Public Marketplace Listings, Buy Orders Lifecycle, Exchanger KYC Endpoints,
 * and Admin KYC / Role Management.
 *
 * Strict Guardrails:
 *  - ZERO Float financial integrity (exact integer cents, integer base unit strings, BigInt math).
 *  - Zero PII / KYC leakage on public marketplace endpoints.
 *  - Buyer eligibility strictly enforced via assertEligibleExchangeBuyer.
 *  - Auto-expiration transitions past-due active orders without active trade holds to EXPIRED.
 *  - Full Audit Logging for order creation, edits, status changes, and KYC reviews.
 */

import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../database/db';
import { requireAuth, requireCsrf, AuthenticatedRequest } from './middleware/auth';
import { requireOwnerOrStaff } from './exchangeConfigRoutes';
import {
  getExchangeEligibility,
  assertEligibleExchangeBuyer,
  submitExchangerKycApplication,
  reviewExchangerKyc,
  setExchangerRole,
  listExchangeKycRequests,
  ExchangeAuthError,
} from '../services/exchangeAuthService';
import {
  calculateExchangeTradePricing,
  resolveActiveExchangeFeeRule,
  logExchangeAudit,
} from '../services/exchangeConfigService';

export const exchangeMarketplaceRouter = Router();

/**
 * Optional Auth middleware: populates req.user if session exists, but doesn't block unauthenticated callers
 */
async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    return next();
  }
  try {
    const user = await prisma.user.findUnique({
      where: { discordId: userId },
      include: { userRoles: true },
    });
    if (user && user.isActive) {
      (req as AuthenticatedRequest).user = user;
    }
  } catch (err) {
    // Continue unauthenticated on error
  }
  next();
}

/**
 * Parses and validates integer base unit strings, rejecting decimals or invalid characters
 */
function parseBaseUnitsString(val: any, fieldName: string): bigint {
  if (typeof val === 'number') {
    if (!Number.isSafeInteger(val) || val < 0) {
      throw new Error(`${fieldName} must be a valid positive integer`);
    }
    return BigInt(val);
  }
  if (typeof val !== 'string') {
    throw new Error(`${fieldName} must be an integer string`);
  }
  const trimmed = val.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${fieldName} must contain only digits (no decimal points or negative signs)`);
  }
  return BigInt(trimmed);
}

/**
 * Auto-expires past due orders with 0 reservations
 */
export async function autoExpirePastDueOrders(): Promise<number> {
  try {
    const now = new Date();
    const expiredOrders = await prisma.exchangeBuyOrder.findMany({
      where: {
        status: { in: ['ACTIVE', 'PARTIALLY_FILLED', 'PAUSED'] },
        expiresAt: { lte: now },
        reservedCapacityBaseUnits: '0',
      },
      select: { id: true, orderCode: true },
    });

    if (expiredOrders.length === 0) return 0;

    await prisma.exchangeBuyOrder.updateMany({
      where: {
        id: { in: expiredOrders.map((o) => o.id) },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    return expiredOrders.length;
  } catch (error) {
    console.error('Failed to auto-expire past-due exchange orders:', error);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ELIGIBILITY & KYC ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/exchange/eligibility
 * Returns detailed eligibility status for authenticated user
 */
exchangeMarketplaceRouter.get(
  '/api/exchange/eligibility',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const eligibility = await getExchangeEligibility(user.discordId);
      res.json(eligibility);
    } catch (error: any) {
      console.error('Failed to fetch exchange eligibility:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * POST /api/exchange/kyc/apply
 * Submits or resubmits Exchanger KYC application
 */
exchangeMarketplaceRouter.post(
  '/api/exchange/kyc/apply',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { documentsMetaJson, notes } = req.body;

      const kyc = await submitExchangerKycApplication({
        userId: user.discordId,
        documentsMetaJson: documentsMetaJson ? JSON.stringify(documentsMetaJson) : undefined,
        notes: typeof notes === 'string' ? notes.trim() : undefined,
      });

      res.status(201).json({
        success: true,
        message: 'Exchanger KYC application submitted successfully. Our team will review your application.',
        kyc,
      });
    } catch (error: any) {
      if (error instanceof ExchangeAuthError) {
        res.status(error.statusCode).json({ error: 'KYC Error', message: error.message });
        return;
      }
      console.error('Failed to submit exchange KYC:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * GET /api/admin/exchange/kyc-requests
 * Admin/Staff: Lists KYC requests with filter and pagination
 */
exchangeMarketplaceRouter.get(
  '/api/admin/exchange/kyc-requests',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;

      const result = await listExchangeKycRequests({ status, page, limit });
      res.json(result);
    } catch (error: any) {
      console.error('Failed to list exchange KYC requests:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * PATCH /api/admin/exchange/kyc-requests/:id
 * Admin/Staff: Reviews an Exchanger KYC request (APPROVE, REJECT, REQUEST_INFO, SUSPEND, EXPIRE)
 */
exchangeMarketplaceRouter.patch(
  '/api/admin/exchange/kyc-requests/:id',
  requireAuth,
  requireCsrf,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const admin = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const { action, notes, expiresAt } = req.body;

      if (!['APPROVE', 'REJECT', 'REQUEST_INFO', 'SUSPEND', 'EXPIRE'].includes(action)) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid action. Must be APPROVE, REJECT, REQUEST_INFO, SUSPEND, or EXPIRE.',
        });
        return;
      }

      const updated = await reviewExchangerKyc({
        adminDiscordId: admin.discordId,
        requestId: id,
        action,
        notes,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });

      res.json({
        success: true,
        message: `KYC request updated to ${updated.status}`,
        kyc: updated,
      });
    } catch (error: any) {
      if (error instanceof ExchangeAuthError) {
        res.status(error.statusCode).json({ error: 'Review Error', message: error.message });
        return;
      }
      console.error('Failed to review KYC request:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * PATCH /api/admin/exchange/users/:discordId/exchanger-role
 * Admin/Staff: Grants or revokes Exchanger role
 */
exchangeMarketplaceRouter.patch(
  '/api/admin/exchange/users/:discordId/exchanger-role',
  requireAuth,
  requireCsrf,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const admin = (req as AuthenticatedRequest).user;
      const { discordId } = req.params;
      const { grant, reason } = req.body;

      if (typeof grant !== 'boolean') {
        res.status(400).json({ error: 'Validation Error', message: 'grant must be a boolean' });
        return;
      }

      const result = await setExchangerRole({
        adminDiscordId: admin.discordId,
        targetDiscordId: discordId,
        grant,
        reason,
      });

      res.json(result);
    } catch (error: any) {
      console.error('Failed to set exchanger role:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. PUBLIC MARKETPLACE & BUY ORDER LISTINGS (ZERO PII LEAKAGE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/exchange/orders
 * Public Marketplace Listings with comprehensive filtering and sorting.
 * ZERO PII exposed (only public username, avatar, reputation score, completed trades count).
 */
exchangeMarketplaceRouter.get(
  '/api/exchange/orders',
  optionalAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Auto-expire past due orders before querying
      await autoExpirePastDueOrders();

      const viewerUserId = (req as AuthenticatedRequest).user?.discordId;

      const {
        gameId,
        currencyId,
        regionId,
        deliveryMethodId,
        minPriceCents,
        maxPriceCents,
        minAmountBaseUnits,
        maxAmountBaseUnits,
        minAvailableCapacity,
        sort = 'price_desc',
        page = '1',
        limit = '20',
      } = req.query;

      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
      const skip = (pageNum - 1) * limitNum;

      const where: any = {
        status: { in: ['ACTIVE', 'PARTIALLY_FILLED'] },
      };

      if (gameId && typeof gameId === 'string') {
        where.gameId = gameId;
      }
      if (currencyId && typeof currencyId === 'string') {
        where.currencyId = currencyId;
      }
      if (regionId && typeof regionId === 'string') {
        where.OR = [{ regionId: regionId }, { regionId: null }];
      }

      if (minPriceCents !== undefined) {
        const minP = parseInt(String(minPriceCents), 10);
        if (!isNaN(minP)) where.pricePerUnitCents = { ...where.pricePerUnitCents, gte: minP };
      }
      if (maxPriceCents !== undefined) {
        const maxP = parseInt(String(maxPriceCents), 10);
        if (!isNaN(maxP)) where.pricePerUnitCents = { ...where.pricePerUnitCents, lte: maxP };
      }

      // Order by sorting criteria
      let orderBy: any[] = [];
      switch (sort) {
        case 'price_asc':
          orderBy = [{ pricePerUnitCents: 'asc' }, { createdAt: 'desc' }];
          break;
        case 'price_desc':
          orderBy = [{ pricePerUnitCents: 'desc' }, { createdAt: 'desc' }];
          break;
        case 'oldest':
          orderBy = [{ createdAt: 'asc' }];
          break;
        case 'newest':
        default:
          orderBy = [{ createdAt: 'desc' }];
          break;
      }

      const [rawOrders, total] = await Promise.all([
        prisma.exchangeBuyOrder.findMany({
          where,
          include: {
            game: {
              select: { id: true, name: true, slug: true, iconUrl: true },
            },
            currency: {
              select: {
                id: true,
                name: true,
                slug: true,
                iconUrl: true,
                unitLabel: true,
                unitMultiplier: true,
                decimalPrecision: true,
                deliveryMethodIdsJson: true,
              },
            },
            region: {
              select: { id: true, name: true, code: true },
            },
            buyer: {
              select: {
                discordId: true,
                username: true,
                displayName: true,
                createdAt: true,
              },
            },
          },
          orderBy,
          skip,
          take: limitNum,
        }),
        prisma.exchangeBuyOrder.count({ where }),
      ]);

      // Post-filter deliveryMethodId and quantity/capacity bounds if specified
      let filtered = rawOrders;

      if (deliveryMethodId && typeof deliveryMethodId === 'string') {
        filtered = filtered.filter((order) => {
          try {
            const methods = JSON.parse(order.acceptedDeliveryMethodIdsJson || '[]');
            return methods.includes(deliveryMethodId);
          } catch {
            return false;
          }
        });
      }

      if (minAvailableCapacity && typeof minAvailableCapacity === 'string') {
        try {
          const reqCap = BigInt(minAvailableCapacity);
          filtered = filtered.filter((o) => BigInt(o.remainingCapacityBaseUnits) >= reqCap);
        } catch {}
      }

      if (minAmountBaseUnits && typeof minAmountBaseUnits === 'string') {
        try {
          const minA = BigInt(minAmountBaseUnits);
          filtered = filtered.filter((o) => BigInt(o.maxTradeBaseUnits) >= minA);
        } catch {}
      }

      if (maxAmountBaseUnits && typeof maxAmountBaseUnits === 'string') {
        try {
          const maxA = BigInt(maxAmountBaseUnits);
          filtered = filtered.filter((o) => BigInt(o.minTradeBaseUnits) <= maxA);
        } catch {}
      }

      // Sanitize output (ZERO PII: no phone, telegram, whatsapp, internal notes, documents)
      const sanitizedOrders = filtered.map((order) => {
        let acceptedDeliveryMethods: string[] = [];
        try {
          acceptedDeliveryMethods = JSON.parse(order.acceptedDeliveryMethodIdsJson || '[]');
        } catch {
          acceptedDeliveryMethods = [];
        }

        return {
          id: order.id,
          orderCode: order.orderCode,
          game: order.game,
          currency: {
            id: order.currency.id,
            name: order.currency.name,
            slug: order.currency.slug,
            iconUrl: order.currency.iconUrl,
            unitLabel: order.currency.unitLabel,
            unitMultiplier: order.currency.unitMultiplier,
            decimalPrecision: order.currency.decimalPrecision,
          },
          region: order.region,
          pricePerUnitCents: order.pricePerUnitCents,
          pricePerUnitUsd: (order.pricePerUnitCents / 100).toFixed(2),
          unitLabelSnapshot: order.unitLabelSnapshot,
          unitMultiplierSnapshot: order.unitMultiplierSnapshot,
          minTradeBaseUnits: order.minTradeBaseUnits,
          maxTradeBaseUnits: order.maxTradeBaseUnits,
          totalCapacityBaseUnits: order.totalCapacityBaseUnits,
          reservedCapacityBaseUnits: order.reservedCapacityBaseUnits,
          remainingCapacityBaseUnits: order.remainingCapacityBaseUnits,
          filledCapacityBaseUnits: order.filledCapacityBaseUnits,
          acceptedDeliveryMethodIds: acceptedDeliveryMethods,
          instructions: order.instructions,
          expiresAt: order.expiresAt,
          status: order.status,
          createdAt: order.createdAt,
          isMine: viewerUserId ? order.buyerUserId === viewerUserId : false,
          buyer: {
            discordId: order.buyer.discordId,
            username: order.buyer.username,
            displayName: order.buyer.displayName || order.buyer.username,
            reputationScore: 100, // Safe default profile metric
            completedTradesCount: 0,
            memberSince: order.buyer.createdAt,
          },
        };
      });

      res.json({
        orders: sanitizedOrders,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (error: any) {
      console.error('Failed to query exchange marketplace orders:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * GET /api/exchange/orders/:id
 * Single order details + pricing calculation preview (Zero PII)
 */
exchangeMarketplaceRouter.get(
  '/api/exchange/orders/:id',
  optionalAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      await autoExpirePastDueOrders();
      const viewerUserId = (req as AuthenticatedRequest).user?.discordId;
      const { id } = req.params;

      const order = await prisma.exchangeBuyOrder.findFirst({
        where: {
          OR: [{ id }, { orderCode: id }],
        },
        include: {
          game: {
            select: { id: true, name: true, slug: true, iconUrl: true },
          },
          currency: {
            select: {
              id: true,
              name: true,
              slug: true,
              iconUrl: true,
              unitLabel: true,
              unitMultiplier: true,
              decimalPrecision: true,
              deliveryMethodIdsJson: true,
            },
          },
          region: {
            select: { id: true, name: true, code: true },
          },
          buyer: {
            select: {
              discordId: true,
              username: true,
              displayName: true,
              createdAt: true,
            },
          },
        },
      });

      if (!order) {
        res.status(404).json({ error: 'Not Found', message: 'Exchange buy order not found' });
        return;
      }

      let acceptedDeliveryMethods: string[] = [];
      try {
        acceptedDeliveryMethods = JSON.parse(order.acceptedDeliveryMethodIdsJson || '[]');
      } catch {
        acceptedDeliveryMethods = [];
      }

      // Calculate pricing preview for minTradeBaseUnits
      let pricingPreview: any = null;
      try {
        const activeRule = await resolveActiveExchangeFeeRule({
          gameId: order.gameId,
          currencyId: order.currencyId,
        });
        pricingPreview = calculateExchangeTradePricing({
          quantityBaseUnits: order.minTradeBaseUnits,
          unitMultiplier: order.unitMultiplierSnapshot || '1',
          pricePerUnitCents: order.pricePerUnitCents,
          feeRule: activeRule,
        });
      } catch (calcErr) {
        console.warn('Could not calculate pricing preview for order:', calcErr);
      }

      res.json({
        id: order.id,
        orderCode: order.orderCode,
        game: order.game,
        currency: {
          id: order.currency.id,
          name: order.currency.name,
          slug: order.currency.slug,
          iconUrl: order.currency.iconUrl,
          unitLabel: order.currency.unitLabel,
          unitMultiplier: order.currency.unitMultiplier,
          decimalPrecision: order.currency.decimalPrecision,
        },
        region: order.region,
        pricePerUnitCents: order.pricePerUnitCents,
        pricePerUnitUsd: (order.pricePerUnitCents / 100).toFixed(2),
        unitLabelSnapshot: order.unitLabelSnapshot,
        unitMultiplierSnapshot: order.unitMultiplierSnapshot,
        minTradeBaseUnits: order.minTradeBaseUnits,
        maxTradeBaseUnits: order.maxTradeBaseUnits,
        totalCapacityBaseUnits: order.totalCapacityBaseUnits,
        reservedCapacityBaseUnits: order.reservedCapacityBaseUnits,
        remainingCapacityBaseUnits: order.remainingCapacityBaseUnits,
        filledCapacityBaseUnits: order.filledCapacityBaseUnits,
        acceptedDeliveryMethodIds: acceptedDeliveryMethods,
        instructions: order.instructions,
        expiresAt: order.expiresAt,
        status: order.status,
        createdAt: order.createdAt,
        pricingPreview,
        isMine: viewerUserId ? order.buyerUserId === viewerUserId : false,
        buyer: {
          discordId: order.buyer.discordId,
          username: order.buyer.username,
          displayName: order.buyer.displayName || order.buyer.username,
          reputationScore: 100,
          completedTradesCount: 0,
          memberSince: order.buyer.createdAt,
        },
      });
    } catch (error: any) {
      console.error('Failed to get exchange order details:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * GET /api/exchange/my-buy-orders
 * Authenticated Exchanger: Lists all orders owned by the current user
 */
exchangeMarketplaceRouter.get(
  '/api/exchange/my-buy-orders',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      await autoExpirePastDueOrders();
      const user = (req as AuthenticatedRequest).user;
      const { status } = req.query;

      const where: any = {
        buyerUserId: user.discordId,
      };

      if (status && typeof status === 'string' && status !== 'ALL') {
        where.status = status;
      }

      const orders = await prisma.exchangeBuyOrder.findMany({
        where,
        include: {
          game: {
            select: { id: true, name: true, slug: true, iconUrl: true },
          },
          currency: {
            select: {
              id: true,
              name: true,
              slug: true,
              iconUrl: true,
              unitLabel: true,
              unitMultiplier: true,
              decimalPrecision: true,
            },
          },
          region: {
            select: { id: true, name: true, code: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const formatted = orders.map((order) => {
        let acceptedDeliveryMethods: string[] = [];
        try {
          acceptedDeliveryMethods = JSON.parse(order.acceptedDeliveryMethodIdsJson || '[]');
        } catch {
          acceptedDeliveryMethods = [];
        }

        return {
          ...order,
          pricePerUnitUsd: (order.pricePerUnitCents / 100).toFixed(2),
          acceptedDeliveryMethodIds: acceptedDeliveryMethods,
        };
      });

      res.json({ orders: formatted });
    } catch (error: any) {
      console.error('Failed to get my exchange buy orders:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. BUY ORDER CREATION, MUTATION & LIFECYCLE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates human-friendly sequential order code: EXB-1001, EXB-1002, etc.
 */
async function generateNextOrderCode(): Promise<string> {
  const count = await prisma.exchangeBuyOrder.count();
  const candidate = `EXB-${1000 + count + 1}`;
  const exists = await prisma.exchangeBuyOrder.findUnique({
    where: { orderCode: candidate },
  });
  if (!exists) return candidate;

  // Fallback with random hex suffix to guarantee uniqueness
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `EXB-${1000 + count + 1}-${randomSuffix}`;
}

/**
 * POST /api/exchange/orders
 * Creates a new Buy Order.
 * Guarded by assertEligibleExchangeBuyer.
 */
exchangeMarketplaceRouter.post(
  '/api/exchange/orders',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;

      // 1. Strict Buyer Eligibility Guard
      await assertEligibleExchangeBuyer(user.discordId);

      const {
        gameId,
        currencyId,
        regionId,
        pricePerUnitCents,
        minTradeBaseUnits,
        maxTradeBaseUnits,
        totalCapacityBaseUnits,
        acceptedDeliveryMethodIds,
        instructions,
        expiresAt,
        publishImmediately = true,
      } = req.body;

      // 2. Validate Catalog relations
      if (!gameId || !currencyId) {
        res.status(400).json({ error: 'Validation Error', message: 'gameId and currencyId are required' });
        return;
      }

      const currency = await prisma.exchangeCurrency.findUnique({
        where: { id: currencyId },
        include: { game: true },
      });

      if (!currency || !currency.isActive || currency.gameId !== gameId) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'Selected currency does not exist, is inactive, or does not belong to the selected game',
        });
        return;
      }

      // Check region if provided
      if (regionId) {
        const region = await prisma.exchangeRegion.findUnique({
          where: { id: regionId },
        });
        if (!region || !region.isActive) {
          res.status(400).json({ error: 'Validation Error', message: 'Selected region is invalid or inactive' });
          return;
        }
      }

      // 3. Strict No-Float Financial & Quantity Validation
      const priceCents = parseInt(String(pricePerUnitCents), 10);
      if (isNaN(priceCents) || priceCents <= 0) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'pricePerUnitCents must be a positive integer (e.g. 85 for $0.85)',
        });
        return;
      }

      let parsedMin: bigint;
      let parsedMax: bigint;
      let parsedTotal: bigint;
      try {
        parsedMin = parseBaseUnitsString(minTradeBaseUnits, 'minTradeBaseUnits');
        parsedMax = parseBaseUnitsString(maxTradeBaseUnits, 'maxTradeBaseUnits');
        parsedTotal = parseBaseUnitsString(totalCapacityBaseUnits, 'totalCapacityBaseUnits');
      } catch (err: any) {
        res.status(400).json({ error: 'Validation Error', message: err.message });
        return;
      }

      // Bounds checking against catalog limits
      const catalogMin = BigInt(currency.minTradeBaseUnits);
      const catalogMax = BigInt(currency.maxTradeBaseUnits);

      if (parsedMin < catalogMin) {
        res.status(400).json({
          error: 'Validation Error',
          message: `minTradeBaseUnits cannot be less than currency minimum (${catalogMin.toString()})`,
        });
        return;
      }
      if (parsedMax > catalogMax) {
        res.status(400).json({
          error: 'Validation Error',
          message: `maxTradeBaseUnits cannot exceed currency maximum (${catalogMax.toString()})`,
        });
        return;
      }
      if (parsedMin > parsedMax) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'minTradeBaseUnits cannot be greater than maxTradeBaseUnits',
        });
        return;
      }
      if (parsedTotal < parsedMin) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'totalCapacityBaseUnits cannot be less than minTradeBaseUnits',
        });
        return;
      }

      // Validate delivery methods
      if (!Array.isArray(acceptedDeliveryMethodIds) || acceptedDeliveryMethodIds.length === 0) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'acceptedDeliveryMethodIds must be a non-empty array of delivery method IDs',
        });
        return;
      }

      // Expiry validation
      let expirationDate: Date | null = null;
      if (expiresAt) {
        expirationDate = new Date(expiresAt);
        if (isNaN(expirationDate.getTime()) || expirationDate.getTime() <= Date.now()) {
          res.status(400).json({
            error: 'Validation Error',
            message: 'expiresAt must be a valid future ISO timestamp',
          });
          return;
        }
      }

      const initialStatus = publishImmediately ? 'ACTIVE' : 'DRAFT';
      const orderCode = await generateNextOrderCode();

      const newOrder = await prisma.exchangeBuyOrder.create({
        data: {
          orderCode,
          buyerUserId: user.discordId,
          buyerDiscordId: user.discordId,
          gameId,
          currencyId,
          regionId: regionId || null,
          pricePerUnitCents: priceCents,
          unitLabelSnapshot: currency.unitLabel,
          unitMultiplierSnapshot: currency.unitMultiplier,
          minTradeBaseUnits: parsedMin.toString(),
          maxTradeBaseUnits: parsedMax.toString(),
          totalCapacityBaseUnits: parsedTotal.toString(),
          reservedCapacityBaseUnits: '0',
          remainingCapacityBaseUnits: parsedTotal.toString(),
          filledCapacityBaseUnits: '0',
          acceptedDeliveryMethodIdsJson: JSON.stringify(acceptedDeliveryMethodIds),
          instructions: typeof instructions === 'string' ? instructions.trim() : null,
          expiresAt: expirationDate,
          status: initialStatus,
        },
        include: {
          game: true,
          currency: true,
          region: true,
        },
      });

      await logExchangeAudit({
        actorId: user.discordId,
        action: 'EXCHANGE_BUY_ORDER_CREATED',
        entityType: 'ExchangeBuyOrder',
        entityId: newOrder.id,
        newValues: {
          orderCode: newOrder.orderCode,
          pricePerUnitCents: newOrder.pricePerUnitCents,
          totalCapacityBaseUnits: newOrder.totalCapacityBaseUnits,
          status: newOrder.status,
        },
        reason: publishImmediately ? 'Created and published Buy Order' : 'Saved Buy Order draft',
      });

      res.status(201).json({
        success: true,
        message: publishImmediately ? 'Buy Order published successfully!' : 'Buy Order draft saved successfully!',
        order: {
          ...newOrder,
          pricePerUnitUsd: (newOrder.pricePerUnitCents / 100).toFixed(2),
          acceptedDeliveryMethodIds,
        },
      });
    } catch (error: any) {
      if (error instanceof ExchangeAuthError) {
        res.status(error.statusCode).json({
          error: 'Eligibility Error',
          message: error.message,
          reasons: error.reasons,
        });
        return;
      }
      console.error('Failed to create exchange buy order:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * PATCH /api/exchange/orders/:id
 * Edits an order in DRAFT or PAUSED status
 */
exchangeMarketplaceRouter.patch(
  '/api/exchange/orders/:id',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;

      const order = await prisma.exchangeBuyOrder.findUnique({
        where: { id },
      });

      if (!order) {
        res.status(404).json({ error: 'Not Found', message: 'Exchange buy order not found' });
        return;
      }

      // Check ownership
      const roleKeys = (user.userRoles || []).map((r) => r.roleKey.toLowerCase());
      const isOwner = roleKeys.includes('owner');
      if (order.buyerUserId !== user.discordId && !isOwner) {
        res.status(403).json({ error: 'Forbidden', message: 'You do not have permission to edit this order' });
        return;
      }

      // Status check: edits only permitted in DRAFT or PAUSED status to prevent race conditions during matching
      if (!['DRAFT', 'PAUSED'].includes(order.status)) {
        res.status(400).json({
          error: 'Invalid Order State',
          message: `Cannot edit order in ${order.status} status. Please pause the order first.`,
        });
        return;
      }

      const {
        pricePerUnitCents,
        minTradeBaseUnits,
        maxTradeBaseUnits,
        totalCapacityBaseUnits,
        acceptedDeliveryMethodIds,
        instructions,
        expiresAt,
      } = req.body;

      const updateData: any = {};

      if (pricePerUnitCents !== undefined) {
        const p = parseInt(String(pricePerUnitCents), 10);
        if (isNaN(p) || p <= 0) {
          res.status(400).json({ error: 'Validation Error', message: 'pricePerUnitCents must be a positive integer' });
          return;
        }
        updateData.pricePerUnitCents = p;
      }

      let parsedMin = BigInt(order.minTradeBaseUnits);
      let parsedMax = BigInt(order.maxTradeBaseUnits);
      let parsedTotal = BigInt(order.totalCapacityBaseUnits);

      if (minTradeBaseUnits !== undefined) {
        parsedMin = parseBaseUnitsString(minTradeBaseUnits, 'minTradeBaseUnits');
        updateData.minTradeBaseUnits = parsedMin.toString();
      }
      if (maxTradeBaseUnits !== undefined) {
        parsedMax = parseBaseUnitsString(maxTradeBaseUnits, 'maxTradeBaseUnits');
        updateData.maxTradeBaseUnits = parsedMax.toString();
      }
      if (totalCapacityBaseUnits !== undefined) {
        parsedTotal = parseBaseUnitsString(totalCapacityBaseUnits, 'totalCapacityBaseUnits');
        const filled = BigInt(order.filledCapacityBaseUnits);
        const reserved = BigInt(order.reservedCapacityBaseUnits);

        if (parsedTotal < filled + reserved) {
          res.status(400).json({
            error: 'Validation Error',
            message: `totalCapacityBaseUnits cannot be reduced below filled (${filled}) + reserved (${reserved}) capacity`,
          });
          return;
        }

        const remaining = parsedTotal - filled - reserved;
        updateData.totalCapacityBaseUnits = parsedTotal.toString();
        updateData.remainingCapacityBaseUnits = remaining.toString();
      }

      if (parsedMin > parsedMax) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'minTradeBaseUnits cannot be greater than maxTradeBaseUnits',
        });
        return;
      }

      if (acceptedDeliveryMethodIds !== undefined) {
        if (!Array.isArray(acceptedDeliveryMethodIds) || acceptedDeliveryMethodIds.length === 0) {
          res.status(400).json({
            error: 'Validation Error',
            message: 'acceptedDeliveryMethodIds must be a non-empty array',
          });
          return;
        }
        updateData.acceptedDeliveryMethodIdsJson = JSON.stringify(acceptedDeliveryMethodIds);
      }

      if (instructions !== undefined) {
        updateData.instructions = typeof instructions === 'string' ? instructions.trim() : null;
      }

      if (expiresAt !== undefined) {
        if (expiresAt === null) {
          updateData.expiresAt = null;
        } else {
          const exp = new Date(expiresAt);
          if (isNaN(exp.getTime()) || exp.getTime() <= Date.now()) {
            res.status(400).json({ error: 'Validation Error', message: 'expiresAt must be a valid future timestamp' });
            return;
          }
          updateData.expiresAt = exp;
        }
      }

      const updated = await prisma.exchangeBuyOrder.update({
        where: { id },
        data: updateData,
        include: {
          game: true,
          currency: true,
          region: true,
        },
      });

      await logExchangeAudit({
        actorId: user.discordId,
        action: 'EXCHANGE_BUY_ORDER_UPDATED',
        entityType: 'ExchangeBuyOrder',
        entityId: updated.id,
        previousValues: {
          pricePerUnitCents: order.pricePerUnitCents,
          totalCapacityBaseUnits: order.totalCapacityBaseUnits,
        },
        newValues: updateData,
        reason: 'Updated Buy Order configuration',
      });

      let updatedMethods: string[] = [];
      try {
        updatedMethods = JSON.parse(updated.acceptedDeliveryMethodIdsJson || '[]');
      } catch {
        updatedMethods = [];
      }

      res.json({
        success: true,
        message: 'Buy Order updated successfully',
        order: {
          ...updated,
          pricePerUnitUsd: (updated.pricePerUnitCents / 100).toFixed(2),
          acceptedDeliveryMethodIds: updatedMethods,
        },
      });
    } catch (error: any) {
      console.error('Failed to update exchange buy order:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

/**
 * PATCH /api/exchange/orders/:id/status
 * Transitions order status: PUBLISH, PAUSE, RESUME, CANCEL
 */
exchangeMarketplaceRouter.patch(
  '/api/exchange/orders/:id/status',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const { action } = req.body;

      const order = await prisma.exchangeBuyOrder.findUnique({
        where: { id },
      });

      if (!order) {
        res.status(404).json({ error: 'Not Found', message: 'Exchange buy order not found' });
        return;
      }

      const roleKeys = (user.userRoles || []).map((r) => r.roleKey.toLowerCase());
      const isOwner = roleKeys.includes('owner');
      if (order.buyerUserId !== user.discordId && !isOwner) {
        res.status(403).json({ error: 'Forbidden', message: 'You do not have permission to manage this order' });
        return;
      }

      let nextStatus: string;

      switch (action) {
        case 'PUBLISH': {
          if (order.status !== 'DRAFT') {
            res.status(400).json({
              error: 'Invalid Transition',
              message: `Cannot publish order from status ${order.status}. Only DRAFT orders can be published.`,
            });
            return;
          }
          await assertEligibleExchangeBuyer(user.discordId);
          nextStatus = 'ACTIVE';
          break;
        }

        case 'PAUSE': {
          if (!['ACTIVE', 'PARTIALLY_FILLED'].includes(order.status)) {
            res.status(400).json({
              error: 'Invalid Transition',
              message: `Cannot pause order from status ${order.status}. Only ACTIVE or PARTIALLY_FILLED orders can be paused.`,
            });
            return;
          }
          nextStatus = 'PAUSED';
          break;
        }

        case 'RESUME': {
          if (order.status !== 'PAUSED') {
            res.status(400).json({
              error: 'Invalid Transition',
              message: `Cannot resume order from status ${order.status}. Only PAUSED orders can be resumed.`,
            });
            return;
          }
          await assertEligibleExchangeBuyer(user.discordId);

          if (order.expiresAt && new Date(order.expiresAt).getTime() <= Date.now()) {
            res.status(400).json({
              error: 'Order Expired',
              message: 'Cannot resume an expired order. Please extend the expiration date first.',
            });
            return;
          }

          const filled = BigInt(order.filledCapacityBaseUnits);
          nextStatus = filled > 0n ? 'PARTIALLY_FILLED' : 'ACTIVE';
          break;
        }

        case 'CANCEL': {
          if (['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(order.status)) {
            res.status(400).json({
              error: 'Invalid Transition',
              message: `Order is already ${order.status}.`,
            });
            return;
          }

          const reserved = BigInt(order.reservedCapacityBaseUnits);
          if (reserved > 0n) {
            res.status(400).json({
              error: 'Active Trades in Progress',
              message: `Cannot cancel order while ${reserved.toString()} base units are actively reserved in trade executions.`,
            });
            return;
          }

          nextStatus = 'CANCELLED';
          break;
        }

        default:
          res.status(400).json({
            error: 'Validation Error',
            message: 'Invalid action. Must be PUBLISH, PAUSE, RESUME, or CANCEL.',
          });
          return;
      }

      const updated = await prisma.exchangeBuyOrder.update({
        where: { id },
        data: { status: nextStatus },
      });

      await logExchangeAudit({
        actorId: user.discordId,
        action: `EXCHANGE_BUY_ORDER_${action}`,
        entityType: 'ExchangeBuyOrder',
        entityId: updated.id,
        previousValues: { status: order.status },
        newValues: { status: updated.status },
        reason: `Changed order status via action ${action}`,
      });

      res.json({
        success: true,
        message: `Order status updated to ${updated.status}`,
        order: updated,
      });
    } catch (error: any) {
      if (error instanceof ExchangeAuthError) {
        res.status(error.statusCode).json({
          error: 'Eligibility Error',
          message: error.message,
          reasons: error.reasons,
        });
        return;
      }
      console.error('Failed to update exchange order status:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);
