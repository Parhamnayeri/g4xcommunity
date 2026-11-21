/**
 * src/web/exchangeConfigRoutes.ts
 *
 * Owner-Only Exchange Configuration & Pricing APIs:
 *  - Public catalog for frontend clients (/api/exchange/catalog)
 *  - Owner Management endpoints (/api/owner/exchange/*)
 *  - Games, Currencies, Regions, Delivery Methods CRUD
 *  - Immutable Versioned Fee Rules & Live Pricing Preview Simulator
 *  - Comprehensive Audit Logging for every mutation
 */

import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../database/db';
import { requireAuth, requireCsrf, AuthenticatedRequest } from './middleware/auth';
import {
  calculateExchangeTradePricing,
  resolveActiveExchangeFeeRule,
  createVersionedExchangeFeeRule,
  ensureExchangeDefaults,
  logExchangeAudit,
} from '../services/exchangeConfigService';

export const exchangeConfigRouter = Router();

/**
 * Strict Owner-Only Gate: checks user.userRoles for 'owner' or OWNER_DISCORD_ID env
 */
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }
  const roleKeys = (user.userRoles || []).map((r) => r.roleKey.toLowerCase());
  const isOwner =
    roleKeys.includes('owner') ||
    (Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId);

  if (!isOwner) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Access Denied: Exchange Configuration mutations are strictly restricted to Owner role.',
    });
    return;
  }
  next();
}

/**
 * Staff / Admin / Owner read gate
 */
export function requireOwnerOrStaff(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }
  const roleKeys = (user.userRoles || []).map((r) => r.roleKey.toLowerCase());
  const isAllowed =
    roleKeys.includes('owner') ||
    roleKeys.includes('admin') ||
    roleKeys.includes('manager') ||
    roleKeys.includes('staff') ||
    (Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId);

  if (!isAllowed) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Access Denied: Staff or Owner access required.',
    });
    return;
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PUBLIC CATALOG ENDPOINT
// ─────────────────────────────────────────────────────────────────────────────

exchangeConfigRouter.get('/api/exchange/catalog', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [games, globalRegions, deliveryMethods] = await Promise.all([
      prisma.exchangeGame.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' },
        include: {
          currencies: {
            where: { isActive: true },
            orderBy: { displayOrder: 'asc' },
          },
          regions: {
            where: { isActive: true },
            orderBy: { displayOrder: 'asc' },
          },
        },
      }),
      prisma.exchangeRegion.findMany({
        where: { isActive: true, gameId: null },
        orderBy: { displayOrder: 'asc' },
      }),
      prisma.exchangeDeliveryMethod.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' },
      }),
    ]);

    res.json({
      success: true,
      data: {
        games,
        globalRegions,
        deliveryMethods,
      },
    });
  } catch (error) {
    console.error('[ExchangeCatalog] Error fetching catalog:', error);
    res.status(500).json({ error: 'Failed to retrieve exchange catalog' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. OWNER / ADMIN OVERVIEW & READ ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

exchangeConfigRouter.get(
  '/api/owner/exchange/overview',
  requireAuth,
  requireOwnerOrStaff,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const [
        gamesCount,
        currenciesCount,
        regionsCount,
        deliveryMethodsCount,
        feeRulesCount,
        activeGlobalRule,
      ] = await Promise.all([
        prisma.exchangeGame.count(),
        prisma.exchangeCurrency.count(),
        prisma.exchangeRegion.count(),
        prisma.exchangeDeliveryMethod.count(),
        prisma.exchangeFeeRule.count(),
        resolveActiveExchangeFeeRule(),
      ]);

      res.json({
        success: true,
        data: {
          gamesCount,
          currenciesCount,
          regionsCount,
          deliveryMethodsCount,
          feeRulesCount,
          activeGlobalRule,
        },
      });
    } catch (error) {
      console.error('[ExchangeOverview] Error fetching overview:', error);
      res.status(500).json({ error: 'Failed to fetch exchange overview' });
    }
  }
);

// Games
exchangeConfigRouter.get(
  '/api/owner/exchange/games',
  requireAuth,
  requireOwnerOrStaff,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const games = await prisma.exchangeGame.findMany({
        orderBy: { displayOrder: 'asc' },
        include: {
          _count: {
            select: { currencies: true, feeRules: true, regions: true },
          },
          currencies: true,
        },
      });
      res.json({ success: true, data: games });
    } catch (error) {
      console.error('[ExchangeGames] Error:', error);
      res.status(500).json({ error: 'Failed to fetch games' });
    }
  }
);

// Currencies
exchangeConfigRouter.get(
  '/api/owner/exchange/currencies',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const gameId = req.query.gameId as string | undefined;
      const currencies = await prisma.exchangeCurrency.findMany({
        where: gameId ? { gameId } : undefined,
        orderBy: [{ gameId: 'asc' }, { displayOrder: 'asc' }],
        include: {
          game: { select: { id: true, name: true, slug: true } },
          _count: { select: { feeRules: true } },
        },
      });
      res.json({ success: true, data: currencies });
    } catch (error) {
      console.error('[ExchangeCurrencies] Error:', error);
      res.status(500).json({ error: 'Failed to fetch currencies' });
    }
  }
);

// Regions
exchangeConfigRouter.get(
  '/api/owner/exchange/regions',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const gameId = req.query.gameId as string | undefined;
      const regions = await prisma.exchangeRegion.findMany({
        where: gameId ? { gameId } : undefined,
        orderBy: { displayOrder: 'asc' },
        include: { game: { select: { id: true, name: true } } },
      });
      res.json({ success: true, data: regions });
    } catch (error) {
      console.error('[ExchangeRegions] Error:', error);
      res.status(500).json({ error: 'Failed to fetch regions' });
    }
  }
);

// Delivery Methods
exchangeConfigRouter.get(
  '/api/owner/exchange/delivery-methods',
  requireAuth,
  requireOwnerOrStaff,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const methods = await prisma.exchangeDeliveryMethod.findMany({
        orderBy: { displayOrder: 'asc' },
      });
      res.json({ success: true, data: methods });
    } catch (error) {
      console.error('[ExchangeDeliveryMethods] Error:', error);
      res.status(500).json({ error: 'Failed to fetch delivery methods' });
    }
  }
);

// Fee Rules (All versioned rules)
exchangeConfigRouter.get(
  '/api/owner/exchange/fee-rules',
  requireAuth,
  requireOwnerOrStaff,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const rules = await prisma.exchangeFeeRule.findMany({
        orderBy: [
          { scope: 'asc' },
          { version: 'desc' },
          { effectiveFrom: 'desc' },
        ],
        include: {
          game: { select: { id: true, name: true, slug: true } },
          currency: { select: { id: true, name: true, slug: true } },
        },
      });
      res.json({ success: true, data: rules });
    } catch (error) {
      console.error('[ExchangeFeeRules] Error:', error);
      res.status(500).json({ error: 'Failed to fetch fee rules' });
    }
  }
);

// Live Fee Preview / Simulator
exchangeConfigRouter.post(
  '/api/owner/exchange/fee-rules/preview',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        quantityBaseUnits,
        unitMultiplier,
        pricePerUnitCents,
        gameId,
        currencyId,
        customRule,
      } = req.body;

      if (!quantityBaseUnits || !unitMultiplier || pricePerUnitCents === undefined) {
        res.status(400).json({
          error: 'Missing required fields: quantityBaseUnits, unitMultiplier, pricePerUnitCents',
        });
        return;
      }

      // If customRule provided, use it directly; otherwise resolve active fee rule
      let activeRule;
      if (customRule && typeof customRule === 'object') {
        activeRule = {
          id: customRule.id || 'SIMULATED',
          version: customRule.version || 1,
          scope: customRule.scope || 'SIMULATED',
          buyerCommissionBps: Number(customRule.buyerCommissionBps) || 0,
          sellerCommissionBps: Number(customRule.sellerCommissionBps) || 0,
          minCommissionCents: customRule.minCommissionCents !== undefined ? Number(customRule.minCommissionCents) : null,
          maxCommissionCents: customRule.maxCommissionCents !== undefined ? Number(customRule.maxCommissionCents) : null,
          paymentProcessingMode: customRule.paymentProcessingMode || 'ACTUAL_COST',
          networkFeeMode: customRule.networkFeeMode || 'ACTUAL_COST',
        };
      } else {
        activeRule = await resolveActiveExchangeFeeRule({ gameId, currencyId });
      }

      const calculation = calculateExchangeTradePricing({
        quantityBaseUnits: String(quantityBaseUnits),
        unitMultiplier: String(unitMultiplier),
        pricePerUnitCents: Math.round(Number(pricePerUnitCents)),
        feeRule: activeRule,
      });

      res.json({
        success: true,
        data: {
          calculation,
          appliedRule: activeRule,
        },
      });
    } catch (error: any) {
      console.error('[ExchangeFeePreview] Calculation error:', error);
      res.status(400).json({ error: error.message || 'Pricing calculation failed' });
    }
  }
);

// Audit Logs
exchangeConfigRouter.get(
  '/api/owner/exchange/audit-logs',
  requireAuth,
  requireOwnerOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
      const entityType = req.query.entityType as string | undefined;

      const logs = await prisma.auditLog.findMany({
        where: entityType
          ? { entityType }
          : {
              entityType: {
                in: [
                  'ExchangeGame',
                  'ExchangeCurrency',
                  'ExchangeRegion',
                  'ExchangeDeliveryMethod',
                  'ExchangeFeeRule',
                ],
              },
            },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      res.json({ success: true, data: logs });
    } catch (error) {
      console.error('[ExchangeAuditLogs] Error:', error);
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. MUTATING ENDPOINTS (STRICT OWNER ONLY + CSRF + AUDIT LOG)
// ─────────────────────────────────────────────────────────────────────────────

// Bootstrap defaults
exchangeConfigRouter.post(
  '/api/owner/exchange/bootstrap',
  requireAuth,
  requireOwner,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const result = await ensureExchangeDefaults();

      await logExchangeAudit({
        actorId,
        action: 'EXCHANGE_BOOTSTRAP_DEFAULTS',
        entityType: 'ExchangeConfig',
        entityId: 'SYSTEM',
        newValues: result,
        reason: 'Seeded default exchange games, currencies, regions, and fee rules',
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('[ExchangeBootstrap] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to seed exchange defaults' });
    }
  }
);

// GAMES: Create
exchangeConfigRouter.post(
  '/api/owner/exchange/games',
  requireAuth,
  requireOwner,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const { name, slug, iconUrl, description, displayOrder, isActive, reason } = req.body;

      if (!name || !slug) {
        res.status(400).json({ error: 'Name and slug are required' });
        return;
      }

      const cleanSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const existing = await prisma.exchangeGame.findUnique({ where: { slug: cleanSlug } });
      if (existing) {
        res.status(400).json({ error: `A game with slug '${cleanSlug}' already exists.` });
        return;
      }

      const game = await prisma.exchangeGame.create({
        data: {
          name: String(name).trim(),
          slug: cleanSlug,
          iconUrl: iconUrl ? String(iconUrl).trim() : null,
          description: description ? String(description).trim() : null,
          displayOrder: Number(displayOrder) || 0,
          isActive: isActive !== false,
        },
      });

      await logExchangeAudit({
        actorId,
        action: 'EXCHANGE_GAME_CREATED',
        entityType: 'ExchangeGame',
        entityId: game.id,
        newValues: game,
        reason: reason || 'Created new exchange game',
      });

      res.json({ success: true, data: game });
    } catch (error: any) {
      console.error('[ExchangeGames:Create] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to create game' });
    }
  }
);

// GAMES: Update
exchangeConfigRouter.patch(
  '/api/owner/exchange/games/:id',
  requireAuth,
  requireOwner,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const { id } = req.params;
      const { name, slug, iconUrl, description, displayOrder, isActive, reason } = req.body;

      const previous = await prisma.exchangeGame.findUnique({ where: { id } });
      if (!previous) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = String(name).trim();
      if (slug !== undefined) updateData.slug = String(slug).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      if (iconUrl !== undefined) updateData.iconUrl = iconUrl ? String(iconUrl).trim() : null;
      if (description !== undefined) updateData.description = description ? String(description).trim() : null;
      if (displayOrder !== undefined) updateData.displayOrder = Number(displayOrder);
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);

      const updated = await prisma.exchangeGame.update({
        where: { id },
        data: updateData,
      });

      await logExchangeAudit({
        actorId,
        action: 'EXCHANGE_GAME_UPDATED',
        entityType: 'ExchangeGame',
        entityId: id,
        previousValues: previous,
        newValues: updated,
        reason: reason || 'Updated exchange game settings',
      });

      res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error('[ExchangeGames:Update] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to update game' });
    }
  }
);

// CURRENCIES: Create
exchangeConfigRouter.post(
  '/api/owner/exchange/currencies',
  requireAuth,
  requireOwner,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const {
        gameId,
        name,
        slug,
        iconUrl,
        unitLabel,
        unitMultiplier,
        decimalPrecision,
        minTradeBaseUnits,
        maxTradeBaseUnits,
        supportedRegionIds,
        deliveryMethodIds,
        displayOrder,
        isActive,
        reason,
      } = req.body;

      if (!gameId || !name || !slug) {
        res.status(400).json({ error: 'gameId, name, and slug are required' });
        return;
      }

      const cleanSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');

      const currency = await prisma.exchangeCurrency.create({
        data: {
          gameId: String(gameId),
          name: String(name).trim(),
          slug: cleanSlug,
          iconUrl: iconUrl ? String(iconUrl).trim() : null,
          unitLabel: unitLabel ? String(unitLabel).trim() : 'Unit',
          unitMultiplier: unitMultiplier ? String(unitMultiplier).trim() : '1',
          decimalPrecision: Number(decimalPrecision) || 0,
          minTradeBaseUnits: minTradeBaseUnits ? String(minTradeBaseUnits).trim() : '1',
          maxTradeBaseUnits: maxTradeBaseUnits ? String(maxTradeBaseUnits).trim() : '1000000000',
          supportedRegionIdsJson: JSON.stringify(supportedRegionIds || []),
          deliveryMethodIdsJson: JSON.stringify(deliveryMethodIds || []),
          displayOrder: Number(displayOrder) || 0,
          isActive: isActive !== false,
        },
      });

      await logExchangeAudit({
        actorId,
        action: 'EXCHANGE_CURRENCY_CREATED',
        entityType: 'ExchangeCurrency',
        entityId: currency.id,
        newValues: currency,
        reason: reason || 'Created exchange currency',
      });

      res.json({ success: true, data: currency });
    } catch (error: any) {
      console.error('[ExchangeCurrencies:Create] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to create currency' });
    }
  }
);

// CURRENCIES: Update
exchangeConfigRouter.patch(
  '/api/owner/exchange/currencies/:id',
  requireAuth,
  requireOwner,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const { id } = req.params;
      const {
        name,
        slug,
        iconUrl,
        unitLabel,
        unitMultiplier,
        decimalPrecision,
        minTradeBaseUnits,
        maxTradeBaseUnits,
        supportedRegionIds,
        deliveryMethodIds,
        displayOrder,
        isActive,
        reason,
      } = req.body;

      const previous = await prisma.exchangeCurrency.findUnique({ where: { id } });
      if (!previous) {
        res.status(404).json({ error: 'Currency not found' });
        return;
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = String(name).trim();
      if (slug !== undefined) updateData.slug = String(slug).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      if (iconUrl !== undefined) updateData.iconUrl = iconUrl ? String(iconUrl).trim() : null;
      if (unitLabel !== undefined) updateData.unitLabel = String(unitLabel).trim();
      if (unitMultiplier !== undefined) updateData.unitMultiplier = String(unitMultiplier).trim();
      if (decimalPrecision !== undefined) updateData.decimalPrecision = Number(decimalPrecision);
      if (minTradeBaseUnits !== undefined) updateData.minTradeBaseUnits = String(minTradeBaseUnits).trim();
      if (maxTradeBaseUnits !== undefined) updateData.maxTradeBaseUnits = String(maxTradeBaseUnits).trim();
      if (supportedRegionIds !== undefined) updateData.supportedRegionIdsJson = JSON.stringify(supportedRegionIds);
      if (deliveryMethodIds !== undefined) updateData.deliveryMethodIdsJson = JSON.stringify(deliveryMethodIds);
      if (displayOrder !== undefined) updateData.displayOrder = Number(displayOrder);
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);

      const updated = await prisma.exchangeCurrency.update({
        where: { id },
        data: updateData,
      });

      await logExchangeAudit({
        actorId,
        action: 'EXCHANGE_CURRENCY_UPDATED',
        entityType: 'ExchangeCurrency',
        entityId: id,
        previousValues: previous,
        newValues: updated,
        reason: reason || 'Updated exchange currency settings',
      });

      res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error('[ExchangeCurrencies:Update] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to update currency' });
    }
  }
);

// REGIONS: Create
exchangeConfigRouter.post(
  '/api/owner/exchange/regions',
  requireAuth,
  requireOwner,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const { code, name, gameId, displayOrder, isActive, reason } = req.body;

      if (!code || !name) {
        res.status(400).json({ error: 'Code and name are required' });
        return;
      }

      const cleanCode = String(code).trim().toUpperCase();

      const region = await prisma.exchangeRegion.create({
        data: {
          code: cleanCode,
          name: String(name).trim(),
          gameId: gameId ? String(gameId) : null,
          displayOrder: Number(displayOrder) || 0,
          isActive: isActive !== false,
        },
      });

      await logExchangeAudit({
        actorId,
        action: 'EXCHANGE_REGION_CREATED',
        entityType: 'ExchangeRegion',
        entityId: region.id,
        newValues: region,
        reason: reason || 'Created exchange region',
      });

      res.json({ success: true, data: region });
    } catch (error: any) {
      console.error('[ExchangeRegions:Create] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to create region' });
    }
  }
);

// REGIONS: Update
exchangeConfigRouter.patch(
  '/api/owner/exchange/regions/:id',
  requireAuth,
  requireOwner,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const { id } = req.params;
      const { code, name, gameId, displayOrder, isActive, reason } = req.body;

      const previous = await prisma.exchangeRegion.findUnique({ where: { id } });
      if (!previous) {
        res.status(404).json({ error: 'Region not found' });
        return;
      }

      const updateData: any = {};
      if (code !== undefined) updateData.code = String(code).trim().toUpperCase();
      if (name !== undefined) updateData.name = String(name).trim();
      if (gameId !== undefined) updateData.gameId = gameId ? String(gameId) : null;
      if (displayOrder !== undefined) updateData.displayOrder = Number(displayOrder);
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);

      const updated = await prisma.exchangeRegion.update({
        where: { id },
        data: updateData,
      });

      await logExchangeAudit({
        actorId,
        action: 'EXCHANGE_REGION_UPDATED',
        entityType: 'ExchangeRegion',
        entityId: id,
        previousValues: previous,
        newValues: updated,
        reason: reason || 'Updated exchange region',
      });

      res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error('[ExchangeRegions:Update] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to update region' });
    }
  }
);

// DELIVERY METHODS: Create
exchangeConfigRouter.post(
  '/api/owner/exchange/delivery-methods',
  requireAuth,
  requireOwner,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const { code, name, description, displayOrder, isActive, reason } = req.body;

      if (!code || !name) {
        res.status(400).json({ error: 'Code and name are required' });
        return;
      }

      const cleanCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');

      const method = await prisma.exchangeDeliveryMethod.create({
        data: {
          code: cleanCode,
          name: String(name).trim(),
          description: description ? String(description).trim() : null,
          displayOrder: Number(displayOrder) || 0,
          isActive: isActive !== false,
        },
      });

      await logExchangeAudit({
        actorId,
        action: 'EXCHANGE_DELIVERY_METHOD_CREATED',
        entityType: 'ExchangeDeliveryMethod',
        entityId: method.id,
        newValues: method,
        reason: reason || 'Created exchange delivery method',
      });

      res.json({ success: true, data: method });
    } catch (error: any) {
      console.error('[ExchangeDeliveryMethods:Create] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to create delivery method' });
    }
  }
);

// DELIVERY METHODS: Update
exchangeConfigRouter.patch(
  '/api/owner/exchange/delivery-methods/:id',
  requireAuth,
  requireOwner,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const { id } = req.params;
      const { code, name, description, displayOrder, isActive, reason } = req.body;

      const previous = await prisma.exchangeDeliveryMethod.findUnique({ where: { id } });
      if (!previous) {
        res.status(404).json({ error: 'Delivery method not found' });
        return;
      }

      const updateData: any = {};
      if (code !== undefined) updateData.code = String(code).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (name !== undefined) updateData.name = String(name).trim();
      if (description !== undefined) updateData.description = description ? String(description).trim() : null;
      if (displayOrder !== undefined) updateData.displayOrder = Number(displayOrder);
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);

      const updated = await prisma.exchangeDeliveryMethod.update({
        where: { id },
        data: updateData,
      });

      await logExchangeAudit({
        actorId,
        action: 'EXCHANGE_DELIVERY_METHOD_UPDATED',
        entityType: 'ExchangeDeliveryMethod',
        entityId: id,
        previousValues: previous,
        newValues: updated,
        reason: reason || 'Updated exchange delivery method',
      });

      res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error('[ExchangeDeliveryMethods:Update] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to update delivery method' });
    }
  }
);

// FEE RULES: Create New Version
exchangeConfigRouter.post(
  '/api/owner/exchange/fee-rules',
  requireAuth,
  requireOwner,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const {
        scope,
        gameId,
        currencyId,
        buyerCommissionBps,
        sellerCommissionBps,
        paymentProcessingMode,
        networkFeeMode,
        minCommissionCents,
        maxCommissionCents,
        effectiveFrom,
        isEnabled,
        reason,
      } = req.body;

      if (!scope || !['GLOBAL', 'GAME', 'CURRENCY'].includes(scope)) {
        res.status(400).json({ error: "scope must be 'GLOBAL', 'GAME', or 'CURRENCY'" });
        return;
      }

      if (buyerCommissionBps === undefined || sellerCommissionBps === undefined) {
        res.status(400).json({ error: 'buyerCommissionBps and sellerCommissionBps are required' });
        return;
      }

      const newRule = await createVersionedExchangeFeeRule({
        scope: scope as 'GLOBAL' | 'GAME' | 'CURRENCY',
        gameId: scope === 'GAME' ? String(gameId) : null,
        currencyId: scope === 'CURRENCY' ? String(currencyId) : null,
        buyerCommissionBps: Number(buyerCommissionBps),
        sellerCommissionBps: Number(sellerCommissionBps),
        paymentProcessingMode: paymentProcessingMode ? String(paymentProcessingMode) : 'ACTUAL_COST',
        networkFeeMode: networkFeeMode ? String(networkFeeMode) : 'ACTUAL_COST',
        minCommissionCents: minCommissionCents !== undefined && minCommissionCents !== null ? Number(minCommissionCents) : null,
        maxCommissionCents: maxCommissionCents !== undefined && maxCommissionCents !== null ? Number(maxCommissionCents) : null,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
        isEnabled: isEnabled !== false,
        createdByDiscordId: actorId,
        reason: reason || 'Created new versioned fee rule',
      });

      res.json({ success: true, data: newRule });
    } catch (error: any) {
      console.error('[ExchangeFeeRules:Create] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to create fee rule' });
    }
  }
);

// FEE RULES: Toggle active status
exchangeConfigRouter.patch(
  '/api/owner/exchange/fee-rules/:id/toggle',
  requireAuth,
  requireOwner,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const { id } = req.params;
      const { isEnabled, reason } = req.body;

      const previous = await prisma.exchangeFeeRule.findUnique({ where: { id } });
      if (!previous) {
        res.status(404).json({ error: 'Fee rule not found' });
        return;
      }

      const updated = await prisma.exchangeFeeRule.update({
        where: { id },
        data: {
          isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : !previous.isEnabled,
        },
      });

      await logExchangeAudit({
        actorId,
        action: 'EXCHANGE_FEE_RULE_STATUS_TOGGLED',
        entityType: 'ExchangeFeeRule',
        entityId: id,
        previousValues: { isEnabled: previous.isEnabled },
        newValues: { isEnabled: updated.isEnabled },
        reason: reason || `Toggled fee rule status to ${updated.isEnabled}`,
      });

      res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error('[ExchangeFeeRules:Toggle] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to toggle fee rule status' });
    }
  }
);
