/**
 * src/services/exchangeConfigService.ts
 *
 * Core configuration, mathematical pricing calculation engine, and audit logging
 * for the G4X In-Game Currency & Items Exchange (Phase 1).
 *
 * Strict Financial Integrity Rules:
 *  - ZERO Float for fees and money.
 *  - Commission rates stored as Basis Points (Int, e.g., 100 = 1.00%, 200 = 2.00%).
 *  - Money stored as Integer Cents (Int, e.g., $1.50 = 150 cents).
 *  - Units and multipliers stored as validated integer strings (String) and operated with BigInt.
 *  - Versioned Fee Rules (immutable version incrementing instead of destructive edits).
 */

import prisma from '../database/db';
import { ExchangeFeeRule, ExchangeGame, ExchangeCurrency, ExchangeRegion, ExchangeDeliveryMethod } from '@prisma/client';

export interface FeeRuleInput {
  id?: string;
  scope?: string;
  version?: number;
  buyerCommissionBps: number;
  sellerCommissionBps: number;
  minCommissionCents?: number | null;
  maxCommissionCents?: number | null;
  paymentProcessingMode?: string;
  networkFeeMode?: string;
}

export interface TradePricingCalculation {
  quantityBaseUnits: string;
  unitMultiplier: string;
  tradeUnits: string;
  pricePerUnitCents: number;
  pricePerUnitUsd: string;
  grossCents: number;
  grossUsd: string;
  buyerCommissionBps: number;
  buyerFeeCents: number;
  buyerFeeUsd: string;
  totalBuyerCents: number;
  totalBuyerUsd: string;
  sellerCommissionBps: number;
  sellerFeeCents: number;
  sellerFeeUsd: string;
  netSellerCents: number;
  netSellerUsd: string;
  appliedFeeRuleId: string;
  appliedFeeRuleVersion: number;
  appliedFeeRuleScope: string;
  paymentProcessingMode: string;
  networkFeeMode: string;
  cappedBuyerMin: boolean;
  cappedBuyerMax: boolean;
  cappedSellerMin: boolean;
  cappedSellerMax: boolean;
}

/**
 * Pure integer-based pricing calculation engine with zero float drift.
 */
export function calculateExchangeTradePricing(params: {
  quantityBaseUnits: string;
  unitMultiplier: string;
  pricePerUnitCents: number;
  feeRule: FeeRuleInput;
}): TradePricingCalculation {
  const { quantityBaseUnits, unitMultiplier, pricePerUnitCents, feeRule } = params;

  // Validate non-negative numbers
  if (!/^\d+$/.test(quantityBaseUnits)) {
    throw new Error('INVALID_QUANTITY: quantityBaseUnits must consist of non-negative integer digits');
  }
  if (!/^\d+$/.test(unitMultiplier) || unitMultiplier === '0') {
    throw new Error('INVALID_MULTIPLIER: unitMultiplier must be a positive integer string');
  }
  if (pricePerUnitCents < 0 || !Number.isInteger(pricePerUnitCents)) {
    throw new Error('INVALID_UNIT_PRICE: pricePerUnitCents must be a non-negative integer');
  }

  const q = BigInt(quantityBaseUnits);
  const mult = BigInt(unitMultiplier);

  // High precision unit calculation (scaled by 10,000 for 4 decimal places)
  const tradeUnitsScaled = (q * 10000n) / mult;
  let tradeUnitsStr: string;
  if (q % mult === 0n) {
    tradeUnitsStr = (q / mult).toString();
  } else {
    tradeUnitsStr = (Number(tradeUnitsScaled) / 10000).toFixed(4).replace(/\.?0+$/, '');
  }

  // Calculate gross cents: (tradeUnitsScaled * pricePerUnitCents + 5000) / 10000 (round half-up)
  const priceBig = BigInt(pricePerUnitCents);
  const grossTradeBig = (tradeUnitsScaled * priceBig + 5000n) / 10000n;
  const grossCents = Number(grossTradeBig);

  // Buyer fee calculation in basis points (100 bps = 1.00% = 100 / 10,000)
  // Half-up rounding: (gross * bps + 5000) / 10000
  const buyerBpsBig = BigInt(Math.max(0, feeRule.buyerCommissionBps));
  let buyerFeeBig = (grossTradeBig * buyerBpsBig + 5000n) / 10000n;
  let buyerFeeCents = Number(buyerFeeBig);

  let cappedBuyerMin = false;
  let cappedBuyerMax = false;

  if (grossCents > 0 && feeRule.minCommissionCents != null && buyerFeeCents < feeRule.minCommissionCents) {
    buyerFeeCents = feeRule.minCommissionCents;
    cappedBuyerMin = true;
  }
  if (feeRule.maxCommissionCents != null && buyerFeeCents > feeRule.maxCommissionCents) {
    buyerFeeCents = feeRule.maxCommissionCents;
    cappedBuyerMax = true;
  }

  // Seller fee calculation in basis points (200 bps = 2.00% = 200 / 10,000)
  const sellerBpsBig = BigInt(Math.max(0, feeRule.sellerCommissionBps));
  let sellerFeeBig = (grossTradeBig * sellerBpsBig + 5000n) / 10000n;
  let sellerFeeCents = Number(sellerFeeBig);

  let cappedSellerMin = false;
  let cappedSellerMax = false;

  if (grossCents > 0 && feeRule.minCommissionCents != null && sellerFeeCents < feeRule.minCommissionCents) {
    sellerFeeCents = feeRule.minCommissionCents;
    cappedSellerMin = true;
  }
  if (feeRule.maxCommissionCents != null && sellerFeeCents > feeRule.maxCommissionCents) {
    sellerFeeCents = feeRule.maxCommissionCents;
    cappedSellerMax = true;
  }

  const totalBuyerCents = grossCents + buyerFeeCents;
  const netSellerCents = Math.max(0, grossCents - sellerFeeCents);

  return {
    quantityBaseUnits,
    unitMultiplier,
    tradeUnits: tradeUnitsStr,
    pricePerUnitCents,
    pricePerUnitUsd: (pricePerUnitCents / 100).toFixed(2),
    grossCents,
    grossUsd: (grossCents / 100).toFixed(2),
    buyerCommissionBps: feeRule.buyerCommissionBps,
    buyerFeeCents,
    buyerFeeUsd: (buyerFeeCents / 100).toFixed(2),
    totalBuyerCents,
    totalBuyerUsd: (totalBuyerCents / 100).toFixed(2),
    sellerCommissionBps: feeRule.sellerCommissionBps,
    sellerFeeCents,
    sellerFeeUsd: (sellerFeeCents / 100).toFixed(2),
    netSellerCents,
    netSellerUsd: (netSellerCents / 100).toFixed(2),
    appliedFeeRuleId: feeRule.id || 'DEFAULT_GLOBAL',
    appliedFeeRuleVersion: feeRule.version || 1,
    appliedFeeRuleScope: feeRule.scope || 'GLOBAL',
    paymentProcessingMode: feeRule.paymentProcessingMode || 'ACTUAL_COST',
    networkFeeMode: feeRule.networkFeeMode || 'ACTUAL_COST',
    cappedBuyerMin,
    cappedBuyerMax,
    cappedSellerMin,
    cappedSellerMax,
  };
}

/**
 * Resolves the currently active fee rule based on strict hierarchy:
 * 1. Specific Currency Override (highest version where isEnabled=true and effectiveFrom <= atDate)
 * 2. Specific Game Override (highest version where isEnabled=true and effectiveFrom <= atDate)
 * 3. Global Default Rule (highest version where isEnabled=true and effectiveFrom <= atDate)
 */
export async function resolveActiveExchangeFeeRule(params?: {
  gameId?: string | null;
  currencyId?: string | null;
  atDate?: Date;
}): Promise<ExchangeFeeRule> {
  const atDate = params?.atDate || new Date();

  // 1. Currency scope
  if (params?.currencyId) {
    const currencyRule = await prisma.exchangeFeeRule.findFirst({
      where: {
        scope: 'CURRENCY',
        currencyId: params.currencyId,
        isEnabled: true,
        effectiveFrom: { lte: atDate },
      },
      orderBy: [
        { version: 'desc' },
        { effectiveFrom: 'desc' },
      ],
    });
    if (currencyRule) return currencyRule;
  }

  // 2. Game scope
  if (params?.gameId) {
    const gameRule = await prisma.exchangeFeeRule.findFirst({
      where: {
        scope: 'GAME',
        gameId: params.gameId,
        isEnabled: true,
        effectiveFrom: { lte: atDate },
      },
      orderBy: [
        { version: 'desc' },
        { effectiveFrom: 'desc' },
      ],
    });
    if (gameRule) return gameRule;
  }

  // 3. Global scope
  const globalRule = await prisma.exchangeFeeRule.findFirst({
    where: {
      scope: 'GLOBAL',
      isEnabled: true,
      effectiveFrom: { lte: atDate },
    },
    orderBy: [
      { version: 'desc' },
      { effectiveFrom: 'desc' },
    ],
  });

  if (globalRule) return globalRule;

  // Fallback if no database rule exists
  return {
    id: 'SYS_DEFAULT_GLOBAL',
    scope: 'GLOBAL',
    gameId: null,
    currencyId: null,
    version: 1,
    buyerCommissionBps: 100, // 1.00%
    sellerCommissionBps: 200, // 2.00%
    paymentProcessingMode: 'ACTUAL_COST',
    networkFeeMode: 'ACTUAL_COST',
    minCommissionCents: null,
    maxCommissionCents: null,
    isEnabled: true,
    effectiveFrom: new Date(0),
    createdByDiscordId: 'SYSTEM',
    reason: 'System fallback global rule',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/**
 * Creates a new versioned fee rule, automatically calculating the next version.
 */
export async function createVersionedExchangeFeeRule(data: {
  scope: 'GLOBAL' | 'GAME' | 'CURRENCY';
  gameId?: string | null;
  currencyId?: string | null;
  buyerCommissionBps: number;
  sellerCommissionBps: number;
  paymentProcessingMode?: string;
  networkFeeMode?: string;
  minCommissionCents?: number | null;
  maxCommissionCents?: number | null;
  isEnabled?: boolean;
  effectiveFrom?: Date;
  createdByDiscordId: string;
  reason?: string;
}): Promise<ExchangeFeeRule> {
  const normalizedGameId = data.scope === 'GAME' ? data.gameId ?? null : null;
  const normalizedCurrencyId = data.scope === 'CURRENCY' ? data.currencyId ?? null : null;

  // Find latest version in this exact scope
  const latestRule = await prisma.exchangeFeeRule.findFirst({
    where: {
      scope: data.scope,
      gameId: normalizedGameId,
      currencyId: normalizedCurrencyId,
    },
    orderBy: { version: 'desc' },
  });

  const nextVersion = (latestRule?.version ?? 0) + 1;

  const newRule = await prisma.exchangeFeeRule.create({
    data: {
      scope: data.scope,
      gameId: normalizedGameId,
      currencyId: normalizedCurrencyId,
      version: nextVersion,
      buyerCommissionBps: data.buyerCommissionBps,
      sellerCommissionBps: data.sellerCommissionBps,
      paymentProcessingMode: data.paymentProcessingMode || 'ACTUAL_COST',
      networkFeeMode: data.networkFeeMode || 'ACTUAL_COST',
      minCommissionCents: data.minCommissionCents ?? null,
      maxCommissionCents: data.maxCommissionCents ?? null,
      isEnabled: data.isEnabled ?? true,
      effectiveFrom: data.effectiveFrom || new Date(),
      createdByDiscordId: data.createdByDiscordId,
      reason: data.reason || `Created fee rule version ${nextVersion}`,
    },
  });

  await logExchangeAudit({
    actorId: data.createdByDiscordId,
    action: 'EXCHANGE_FEE_RULE_VERSION_CREATED',
    entityType: 'ExchangeFeeRule',
    entityId: newRule.id,
    previousValues: latestRule ? { id: latestRule.id, version: latestRule.version } : null,
    newValues: {
      id: newRule.id,
      version: newRule.version,
      scope: newRule.scope,
      buyerCommissionBps: newRule.buyerCommissionBps,
      sellerCommissionBps: newRule.sellerCommissionBps,
      minCommissionCents: newRule.minCommissionCents,
      maxCommissionCents: newRule.maxCommissionCents,
      effectiveFrom: newRule.effectiveFrom,
    },
    reason: data.reason || `Created fee rule version ${nextVersion}`,
  });

  return newRule;
}

/**
 * Standard audit logger for Exchange entity mutations
 */
export async function logExchangeAudit(params: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValues?: any;
  newValues?: any;
  reason?: string;
}): Promise<void> {
  try {
    let validActorId: string | null = null;
    if (params.actorId && params.actorId !== 'SYSTEM') {
      const userExists = await prisma.user.findUnique({
        where: { discordId: params.actorId },
        select: { discordId: true },
      });
      if (userExists) {
        validActorId = params.actorId;
      }
    }

    await prisma.auditLog.create({
      data: {
        actorId: validActorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        previousValues: params.previousValues ? JSON.stringify(params.previousValues) : null,
        newValues: params.newValues ? JSON.stringify(params.newValues) : null,
        reason: params.reason || (params.actorId ? `Actor: ${params.actorId}` : 'Owner Exchange Configuration Update'),
        isSuccess: true,
      },
    });
  } catch (err) {
    console.error('[ExchangeAuditLog] Failed to record audit log:', err);
  }
}

/**
 * Idempotently seeds default exchange regions, delivery methods, fee rules, and games.
 */
export async function ensureExchangeDefaults(): Promise<{
  regionsSeeded: number;
  deliveryMethodsSeeded: number;
  feeRulesSeeded: number;
  gamesSeeded: number;
}> {
  let regionsSeeded = 0;
  let deliveryMethodsSeeded = 0;
  let feeRulesSeeded = 0;
  let gamesSeeded = 0;

  // 1. Default Regions
  const defaultRegions = [
    { code: 'EU', name: 'Europe', displayOrder: 1 },
    { code: 'US', name: 'North America', displayOrder: 2 },
    { code: 'ASIA', name: 'Asia-Pacific', displayOrder: 3 },
    { code: 'GLOBAL', name: 'Global / Cross-Region', displayOrder: 4 },
  ];

  for (const r of defaultRegions) {
    const existing = await prisma.exchangeRegion.findFirst({
      where: { code: r.code, gameId: null },
    });
    if (!existing) {
      await prisma.exchangeRegion.create({
        data: {
          code: r.code,
          name: r.name,
          displayOrder: r.displayOrder,
          isActive: true,
          gameId: null,
        },
      });
      regionsSeeded++;
    }
  }

  // 2. Default Delivery Methods
  const defaultDeliveryMethods = [
    {
      code: 'IN_GAME_TRADE',
      name: 'In-Game Face-to-Face Trade',
      description: 'Direct in-game trade between player characters at a designated city or tavern.',
      displayOrder: 1,
    },
    {
      code: 'IN_GAME_MAIL',
      name: 'In-Game Mail',
      description: 'Delivery sent directly to your character via the in-game mailbox.',
      displayOrder: 2,
    },
    {
      code: 'AUCTION_HOUSE',
      name: 'Auction House Buyout',
      description: 'Seller buys out an agreed dummy item listed by the buyer on the game auction house.',
      displayOrder: 3,
    },
    {
      code: 'GUILD_BANK',
      name: 'Guild Bank Deposit',
      description: 'Delivery deposited directly into a designated shared guild vault/bank.',
      displayOrder: 4,
    },
  ];

  for (const m of defaultDeliveryMethods) {
    const existing = await prisma.exchangeDeliveryMethod.findUnique({
      where: { code: m.code },
    });
    if (!existing) {
      await prisma.exchangeDeliveryMethod.create({
        data: {
          code: m.code,
          name: m.name,
          description: m.description,
          displayOrder: m.displayOrder,
          isActive: true,
        },
      });
      deliveryMethodsSeeded++;
    }
  }

  // 3. Default Global Fee Rule
  const existingGlobalRule = await prisma.exchangeFeeRule.findFirst({
    where: { scope: 'GLOBAL' },
  });
  if (!existingGlobalRule) {
    await prisma.exchangeFeeRule.create({
      data: {
        scope: 'GLOBAL',
        version: 1,
        buyerCommissionBps: 100, // 1.00%
        sellerCommissionBps: 200, // 2.00%
        paymentProcessingMode: 'ACTUAL_COST',
        networkFeeMode: 'ACTUAL_COST',
        minCommissionCents: 50, // $0.50 min
        maxCommissionCents: 10000, // $100.00 max
        isEnabled: true,
        createdByDiscordId: 'SYSTEM',
        reason: 'Initial default global exchange fee rule',
      },
    });
    feeRulesSeeded++;
  }

  // 4. Default Games & Currencies if none exist
  const existingGamesCount = await prisma.exchangeGame.count();
  if (existingGamesCount === 0) {
    // World of Warcraft
    const wow = await prisma.exchangeGame.create({
      data: {
        slug: 'wow',
        name: 'World of Warcraft',
        iconUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2694.png',
        description: 'Blizzard Entertainment MMORPG gold and currency exchange',
        displayOrder: 1,
        isActive: true,
      },
    });
    await prisma.exchangeCurrency.create({
      data: {
        gameId: wow.id,
        name: 'Gold',
        slug: 'gold',
        unitLabel: '100K Gold',
        unitMultiplier: '100000',
        decimalPrecision: 0,
        minTradeBaseUnits: '100000',
        maxTradeBaseUnits: '100000000',
        isActive: true,
        displayOrder: 1,
      },
    });

    // Path of Exile
    const poe = await prisma.exchangeGame.create({
      data: {
        slug: 'poe',
        name: 'Path of Exile',
        iconUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f525.png',
        description: 'Grinding Gear Games ARPG currency exchange',
        displayOrder: 2,
        isActive: true,
      },
    });
    await prisma.exchangeCurrency.create({
      data: {
        gameId: poe.id,
        name: 'Divine Orb',
        slug: 'divine-orb',
        unitLabel: '1 Divine',
        unitMultiplier: '1',
        decimalPrecision: 0,
        minTradeBaseUnits: '1',
        maxTradeBaseUnits: '10000',
        isActive: true,
        displayOrder: 1,
      },
    });

    // Diablo IV
    const diablo = await prisma.exchangeGame.create({
      data: {
        slug: 'diablo-4',
        name: 'Diablo IV',
        iconUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f480.png',
        description: 'Sanctuary Gold & Materials exchange',
        displayOrder: 3,
        isActive: true,
      },
    });
    await prisma.exchangeCurrency.create({
      data: {
        gameId: diablo.id,
        name: 'Gold',
        slug: 'gold',
        unitLabel: '100M Gold',
        unitMultiplier: '100000000',
        decimalPrecision: 0,
        minTradeBaseUnits: '100000000',
        maxTradeBaseUnits: '10000000000',
        isActive: true,
        displayOrder: 1,
      },
    });

    gamesSeeded = 3;
  }

  return { regionsSeeded, deliveryMethodsSeeded, feeRulesSeeded, gamesSeeded };
}
