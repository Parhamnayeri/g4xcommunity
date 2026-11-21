/**
 * src/services/exchangeTradeService.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 4:
 * Seller Offer System, Partial Fulfillment, Atomic Capacity Reservation, and Trade Creation.
 *
 * Strict Guardrails:
 *  - ZERO Float for financial calculations & quantities (exact integer cents, integer base unit strings, BigInt math).
 *  - 6-Point Automatic Sell Offer Validator (Role, Active Order, Capacity, Trade Limits, Currency/Region, Delivery Method).
 *  - Anti-Self-Trading check (Buyer cannot submit sell offers on their own buy order).
 *  - Concurrency & Zero-Overselling Protection via version check & atomic conditional updates.
 *  - Immutable Fee Rule & Price Snapshots at the moment of Trade creation.
 *  - Capacity Release & Order Status Restoration on pre-payment trade cancellation.
 *  - Complete Trade Event Timeline and Exchange Audit Logging.
 */

import prisma from '../database/db';
import {
  ExchangeBuyOrder,
  ExchangeSellOffer,
  ExchangeTrade,
  ExchangeTradeEvent,
} from '@prisma/client';
import {
  assertEligibleExchangeBuyer,
  assertEligibleExchangeSeller,
} from './exchangeAuthService';
import {
  calculateExchangeTradePricing,
  resolveActiveExchangeFeeRule,
  logExchangeAudit,
  TradePricingCalculation,
} from './exchangeConfigService';

export class ConcurrencyConflictError extends Error {
  public statusCode: number;

  constructor(message: string = 'Order capacity changed concurrently, please retry') {
    super(message);
    this.name = 'ConcurrencyConflictError';
    this.statusCode = 409;
  }
}

export class TradeValidationError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'TradeValidationError';
    this.statusCode = statusCode;
  }
}

/**
 * Generates human-friendly sequential offer code: EXS-1001, EXS-1002, etc.
 */
export async function generateNextOfferCode(tx: any = prisma): Promise<string> {
  const count = await tx.exchangeSellOffer.count();
  const candidate = `EXS-${1000 + count + 1}`;
  const exists = await tx.exchangeSellOffer.findUnique({
    where: { offerCode: candidate },
  });
  if (!exists) return candidate;

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `EXS-${1000 + count + 1}-${randomSuffix}`;
}

/**
 * Generates human-friendly sequential trade code: EXT-1001, EXT-1002, etc.
 */
export async function generateNextTradeCode(tx: any = prisma): Promise<string> {
  const count = await tx.exchangeTrade.count();
  const candidate = `EXT-${1000 + count + 1}`;
  const exists = await tx.exchangeTrade.findUnique({
    where: { tradeCode: candidate },
  });
  if (!exists) return candidate;

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `EXT-${1000 + count + 1}-${randomSuffix}`;
}

export interface PreviewSellOfferInput {
  buyOrderId: string;
  offeredAmountBaseUnits: string;
}

export interface SellOfferPreviewResult {
  pricing: TradePricingCalculation;
  buyOrder: {
    id: string;
    orderCode: string;
    unitLabelSnapshot: string;
    unitMultiplierSnapshot: string;
    pricePerUnitCents: number;
    remainingCapacityBaseUnits: string;
  };
}

/**
 * Previews pricing, fees, and net payout for an intended sell offer without saving anything.
 */
export async function previewSellOfferPricing(
  params: PreviewSellOfferInput
): Promise<SellOfferPreviewResult> {
  const { buyOrderId, offeredAmountBaseUnits } = params;

  if (!/^\d+$/.test(offeredAmountBaseUnits) || offeredAmountBaseUnits === '0') {
    throw new TradeValidationError('offeredAmountBaseUnits must be a positive integer digits string');
  }

  const buyOrder = await prisma.exchangeBuyOrder.findUnique({
    where: { id: buyOrderId },
    include: { currency: true, game: true },
  });

  if (!buyOrder) {
    throw new TradeValidationError('Buy order not found', 404);
  }

  const feeRule = await resolveActiveExchangeFeeRule({
    gameId: buyOrder.gameId,
    currencyId: buyOrder.currencyId,
  });

  const pricing = calculateExchangeTradePricing({
    quantityBaseUnits: offeredAmountBaseUnits,
    unitMultiplier: buyOrder.unitMultiplierSnapshot,
    pricePerUnitCents: buyOrder.pricePerUnitCents,
    feeRule,
  });

  return {
    pricing,
    buyOrder: {
      id: buyOrder.id,
      orderCode: buyOrder.orderCode,
      unitLabelSnapshot: buyOrder.unitLabelSnapshot,
      unitMultiplierSnapshot: buyOrder.unitMultiplierSnapshot,
      pricePerUnitCents: buyOrder.pricePerUnitCents,
      remainingCapacityBaseUnits: buyOrder.remainingCapacityBaseUnits,
    },
  };
}

export interface SubmitSellOfferInput {
  buyOrderId: string;
  sellerUserId: string;
  offeredAmountBaseUnits: string;
  deliveryMethodId: string;
  estimatedDeliveryMinutes?: number;
  additionalInfo?: string;
}

/**
 * Submits a new Sell Offer on an active Buy Order.
 * Enforces the 6-Point Automatic Validator and Anti-Self-Trading rules.
 */
export async function submitSellOffer(
  params: SubmitSellOfferInput
): Promise<ExchangeSellOffer> {
  const {
    buyOrderId,
    sellerUserId,
    offeredAmountBaseUnits,
    deliveryMethodId,
    estimatedDeliveryMinutes,
    additionalInfo,
  } = params;

  // 1. Point 1: Active Role Check (Seller Guard)
  // Seller requires at least 1 active G4X role and non-suspended status. No KYC required.
  await assertEligibleExchangeSeller(sellerUserId);

  // 2. Point 2: Buy Order Active Check
  const buyOrder = await prisma.exchangeBuyOrder.findUnique({
    where: { id: buyOrderId },
    include: { currency: true, game: true, region: true },
  });

  if (!buyOrder) {
    throw new TradeValidationError('Buy order not found', 404);
  }

  if (!['ACTIVE', 'PARTIALLY_FILLED'].includes(buyOrder.status)) {
    throw new TradeValidationError(
      `Buy order is currently ${buyOrder.status} and cannot receive new sell offers.`
    );
  }

  if (buyOrder.expiresAt && new Date() > buyOrder.expiresAt) {
    throw new TradeValidationError('Buy order has expired.');
  }

  // Point 3: Anti-Self-Trading Check
  if (buyOrder.buyerUserId === sellerUserId) {
    throw new TradeValidationError('You cannot submit a sell offer to your own buy order.');
  }

  // Point 4: Validate positive integer quantity
  if (!/^\d+$/.test(offeredAmountBaseUnits) || offeredAmountBaseUnits === '0') {
    throw new TradeValidationError('offeredAmountBaseUnits must be a positive integer digits string.');
  }

  const offerBig = BigInt(offeredAmountBaseUnits);
  const remainingBig = BigInt(buyOrder.remainingCapacityBaseUnits);
  const minTradeBig = BigInt(buyOrder.minTradeBaseUnits);
  const maxTradeBig = BigInt(buyOrder.maxTradeBaseUnits);

  // Point 5: Sufficient Capacity Check
  if (offerBig > remainingBig) {
    throw new TradeValidationError(
      `Offered amount (${offerBig.toString()}) exceeds the order's remaining capacity (${remainingBig.toString()}).`
    );
  }

  // Point 6: Allowed Trade Limits Check
  if (offerBig < minTradeBig) {
    throw new TradeValidationError(
      `Offered amount (${offerBig.toString()}) is below the order's minimum trade limit (${minTradeBig.toString()}).`
    );
  }

  if (offerBig > maxTradeBig) {
    throw new TradeValidationError(
      `Offered amount (${offerBig.toString()}) exceeds the order's maximum trade limit (${maxTradeBig.toString()}).`
    );
  }

  // Point 7: Accepted Delivery Method Check
  let acceptedDeliveryMethodIds: string[] = [];
  try {
    acceptedDeliveryMethodIds = JSON.parse(buyOrder.acceptedDeliveryMethodIdsJson || '[]');
  } catch (e) {
    acceptedDeliveryMethodIds = [];
  }

  if (!acceptedDeliveryMethodIds.includes(deliveryMethodId)) {
    throw new TradeValidationError(
      'The selected delivery method is not accepted by this buy order.'
    );
  }

  // Ensure delivery method exists and is active
  const deliveryMethod = await prisma.exchangeDeliveryMethod.findUnique({
    where: { id: deliveryMethodId },
  });
  if (!deliveryMethod || !deliveryMethod.isActive) {
    throw new TradeValidationError('The selected delivery method is invalid or inactive.');
  }

  // Generate unique offer code
  const offerCode = await generateNextOfferCode();

  const sellOffer = await prisma.exchangeSellOffer.create({
    data: {
      offerCode,
      buyOrderId: buyOrder.id,
      sellerUserId,
      sellerDiscordId: sellerUserId,
      currencyId: buyOrder.currencyId,
      regionId: buyOrder.regionId,
      offeredAmountBaseUnits: offerBig.toString(),
      deliveryMethodId,
      estimatedDeliveryMinutes:
        typeof estimatedDeliveryMinutes === 'number' && estimatedDeliveryMinutes > 0
          ? estimatedDeliveryMinutes
          : 30,
      additionalInfo: additionalInfo?.trim() || null,
      status: 'PENDING',
    },
    include: {
      buyOrder: {
        select: {
          id: true,
          orderCode: true,
          unitLabelSnapshot: true,
          pricePerUnitCents: true,
        },
      },
      currency: { select: { id: true, name: true, unitLabel: true } },
      deliveryMethod: { select: { id: true, name: true, description: true } },
    },
  });

  await logExchangeAudit({
    actorId: sellerUserId,
    action: 'EXCHANGE_SELL_OFFER_SUBMITTED',
    entityType: 'EXCHANGE_SELL_OFFER',
    entityId: sellOffer.id,
    newValues: {
      offerCode: sellOffer.offerCode,
      buyOrderId: buyOrder.id,
      buyOrderCode: buyOrder.orderCode,
      offeredAmountBaseUnits: sellOffer.offeredAmountBaseUnits,
      deliveryMethodId,
    },
  });

  return sellOffer;
}

export interface AcceptSellOfferInput {
  offerId: string;
  buyerUserId: string;
  isStaffOrOwner?: boolean;
}

/**
 * Atomically accepts a Sell Offer, reserves capacity, updates buy order status,
 * snapshots fee rule and pricing, and creates an Exchange Trade.
 * Protected against concurrency conflicts with version checking.
 */
export async function acceptSellOffer(
  params: AcceptSellOfferInput
): Promise<ExchangeTrade> {
  const { offerId, buyerUserId, isStaffOrOwner = false } = params;

  // 1. Fetch offer and verify relations
  const offer = await prisma.exchangeSellOffer.findUnique({
    where: { id: offerId },
    include: {
      buyOrder: true,
      currency: true,
      deliveryMethod: true,
    },
  });

  if (!offer) {
    throw new TradeValidationError('Sell offer not found', 404);
  }

  // 2. Buyer ownership check (or staff/owner override)
  if (offer.buyOrder.buyerUserId !== buyerUserId && !isStaffOrOwner) {
    throw new TradeValidationError('Unauthorized: Only the buyer can accept this sell offer.', 403);
  }

  // 3. Buyer eligibility verification (KYC & permission check)
  await assertEligibleExchangeBuyer(offer.buyOrder.buyerUserId);

  // 4. Offer status check
  if (offer.status !== 'PENDING') {
    throw new TradeValidationError(
      `Offer is already ${offer.status} and cannot be accepted.`,
      400
    );
  }

  // 5. Atomic Prisma Transaction
  const result = await prisma.$transaction(async (tx) => {
    // Re-query buy order inside transaction
    const buyOrder = await tx.exchangeBuyOrder.findUnique({
      where: { id: offer.buyOrderId },
    });

    if (!buyOrder) {
      throw new TradeValidationError('Associated buy order no longer exists.', 404);
    }

    if (!['ACTIVE', 'PARTIALLY_FILLED'].includes(buyOrder.status)) {
      throw new TradeValidationError(
        `Buy order is ${buyOrder.status} and cannot accept offers.`
      );
    }

    const offerQtyBig = BigInt(offer.offeredAmountBaseUnits);
    const remainingBig = BigInt(buyOrder.remainingCapacityBaseUnits);
    const reservedBig = BigInt(buyOrder.reservedCapacityBaseUnits);

    if (offerQtyBig > remainingBig) {
      throw new TradeValidationError(
        `Insufficient capacity: Offer requires ${offerQtyBig.toString()} base units, but only ${remainingBig.toString()} remaining.`
      );
    }

    const newRemaining = remainingBig - offerQtyBig;
    const newReserved = reservedBig + offerQtyBig;
    const nextOrderStatus = newRemaining === 0n ? 'FULLY_RESERVED' : 'PARTIALLY_FILLED';

    // Atomic conditional update on Buy Order with version check
    const orderUpdateResult = await tx.exchangeBuyOrder.updateMany({
      where: {
        id: buyOrder.id,
        version: buyOrder.version,
        remainingCapacityBaseUnits: buyOrder.remainingCapacityBaseUnits,
        reservedCapacityBaseUnits: buyOrder.reservedCapacityBaseUnits,
        status: { in: ['ACTIVE', 'PARTIALLY_FILLED'] },
      },
      data: {
        remainingCapacityBaseUnits: newRemaining.toString(),
        reservedCapacityBaseUnits: newReserved.toString(),
        status: nextOrderStatus,
        version: { increment: 1 },
      },
    });

    if (orderUpdateResult.count !== 1) {
      throw new ConcurrencyConflictError(
        'Order capacity changed concurrently, please retry.'
      );
    }

    // Atomic update on Sell Offer to ACCEPTED
    const offerUpdateResult = await tx.exchangeSellOffer.updateMany({
      where: {
        id: offer.id,
        status: 'PENDING',
      },
      data: {
        status: 'ACCEPTED',
        respondedAt: new Date(),
      },
    });

    if (offerUpdateResult.count !== 1) {
      throw new TradeValidationError(
        'Sell offer is no longer PENDING (may have been accepted or withdrawn concurrently).'
      );
    }

    // Resolve active fee rule snapshot at this exact moment
    const feeRule = await resolveActiveExchangeFeeRule({
      gameId: buyOrder.gameId,
      currencyId: buyOrder.currencyId,
    });

    // Calculate exact pricing
    const pricing = calculateExchangeTradePricing({
      quantityBaseUnits: offer.offeredAmountBaseUnits,
      unitMultiplier: buyOrder.unitMultiplierSnapshot,
      pricePerUnitCents: buyOrder.pricePerUnitCents,
      feeRule,
    });

    // Generate unique trade code
    const tradeCode = await generateNextTradeCode(tx);

    // Create Exchange Trade record
    const trade = await tx.exchangeTrade.create({
      data: {
        tradeCode,
        buyOrderId: buyOrder.id,
        sellOfferId: offer.id,
        buyerUserId: buyOrder.buyerUserId,
        buyerDiscordId: buyOrder.buyerDiscordId,
        sellerUserId: offer.sellerUserId,
        sellerDiscordId: offer.sellerDiscordId,
        gameId: buyOrder.gameId,
        currencyId: buyOrder.currencyId,
        regionId: buyOrder.regionId,
        deliveryMethodId: offer.deliveryMethodId,

        // Immutable Pricing & Quantity Snapshot
        quantityBaseUnits: offer.offeredAmountBaseUnits,
        unitLabelSnapshot: buyOrder.unitLabelSnapshot,
        unitMultiplierSnapshot: buyOrder.unitMultiplierSnapshot,
        pricePerUnitCentsSnapshot: buyOrder.pricePerUnitCents,
        grossValueCents: pricing.grossCents,

        // Immutable Fee Rule Snapshot
        feeRuleIdSnapshot: feeRule.id,
        feeRuleVersionSnapshot: feeRule.version,
        feeRuleScopeSnapshot: feeRule.scope,
        buyerCommissionBpsSnapshot: feeRule.buyerCommissionBps,
        sellerCommissionBpsSnapshot: feeRule.sellerCommissionBps,
        paymentProcessingModeSnapshot: feeRule.paymentProcessingMode,
        networkFeeModeSnapshot: feeRule.networkFeeMode,
        buyerFeeCents: pricing.buyerFeeCents,
        sellerFeeCents: pricing.sellerFeeCents,
        netSellerCents: pricing.netSellerCents,
        buyerTotalPayableCents: pricing.totalBuyerCents,

        status: 'AWAITING_PAYMENT',
        capacityReserved: true,
        estimatedDeliveryMinutes: offer.estimatedDeliveryMinutes,
        sellerNotes: offer.additionalInfo,
        buyerInstructionsSnapshot: buyOrder.instructions,
      },
      include: {
        buyOrder: {
          select: {
            id: true,
            orderCode: true,
            status: true,
          },
        },
        game: { select: { id: true, name: true, slug: true, iconUrl: true } },
        currency: { select: { id: true, name: true, unitLabel: true, unitMultiplier: true } },
        region: { select: { id: true, name: true, code: true } },
        deliveryMethod: { select: { id: true, name: true, description: true } },
        seller: {
          select: {
            discordId: true,
            username: true,
            displayName: true,
          },
        },
        buyer: {
          select: {
            discordId: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    // Record Trade Events
    await tx.exchangeTradeEvent.create({
      data: {
        tradeId: trade.id,
        eventType: 'OFFER_ACCEPTED',
        actorUserId: buyerUserId,
        actorDiscordId: buyerUserId,
        actorRole: isStaffOrOwner ? 'ADMIN' : 'BUYER',
        toStatus: 'AWAITING_PAYMENT',
        note: `Buyer accepted offer ${offer.offerCode}. Trade created.`,
      },
    });

    await tx.exchangeTradeEvent.create({
      data: {
        tradeId: trade.id,
        eventType: 'CAPACITY_RESERVED',
        actorUserId: null,
        actorDiscordId: 'SYSTEM',
        actorRole: 'SYSTEM',
        note: `Reserved ${offer.offeredAmountBaseUnits} base units on buy order ${buyOrder.orderCode}. Remaining capacity: ${newRemaining.toString()}`,
      },
    });

    return { trade, buyOrder, newRemaining, nextOrderStatus };
  }, { timeout: 15000, maxWait: 10000 });

  await logExchangeAudit({
    actorId: buyerUserId,
    action: 'EXCHANGE_SELL_OFFER_ACCEPTED',
    entityType: 'EXCHANGE_TRADE',
    entityId: result.trade.id,
    newValues: {
      tradeCode: result.trade.tradeCode,
      offerId: offer.id,
      offerCode: offer.offerCode,
      buyOrderId: result.buyOrder.id,
      reservedQuantity: offer.offeredAmountBaseUnits,
      newRemainingCapacity: result.newRemaining.toString(),
      nextOrderStatus: result.nextOrderStatus,
    },
  });

  return result.trade;
}

export interface RejectSellOfferInput {
  offerId: string;
  buyerUserId: string;
  reason?: string;
  isStaffOrOwner?: boolean;
}

/**
 * Rejects a pending Sell Offer.
 */
export async function rejectSellOffer(
  params: RejectSellOfferInput
): Promise<ExchangeSellOffer> {
  const { offerId, buyerUserId, reason, isStaffOrOwner = false } = params;

  const offer = await prisma.exchangeSellOffer.findUnique({
    where: { id: offerId },
    include: { buyOrder: true },
  });

  if (!offer) {
    throw new TradeValidationError('Sell offer not found', 404);
  }

  if (offer.buyOrder.buyerUserId !== buyerUserId && !isStaffOrOwner) {
    throw new TradeValidationError('Unauthorized: Only the buyer can reject this offer.', 403);
  }

  if (offer.status !== 'PENDING') {
    throw new TradeValidationError(`Offer is already ${offer.status} and cannot be rejected.`);
  }

  const updatedOffer = await prisma.exchangeSellOffer.update({
    where: { id: offer.id },
    data: {
      status: 'REJECTED',
      rejectionReason: reason?.trim() || null,
      respondedAt: new Date(),
    },
  });

  await logExchangeAudit({
    actorId: buyerUserId,
    action: 'EXCHANGE_SELL_OFFER_REJECTED',
    entityType: 'EXCHANGE_SELL_OFFER',
    entityId: offer.id,
    newValues: {
      offerCode: offer.offerCode,
      reason: reason?.trim() || null,
    },
  });

  return updatedOffer;
}

export interface WithdrawSellOfferInput {
  offerId: string;
  sellerUserId: string;
  isStaffOrOwner?: boolean;
}

/**
 * Withdraws a pending Sell Offer by the seller.
 */
export async function withdrawSellOffer(
  params: WithdrawSellOfferInput
): Promise<ExchangeSellOffer> {
  const { offerId, sellerUserId, isStaffOrOwner = false } = params;

  const offer = await prisma.exchangeSellOffer.findUnique({
    where: { id: offerId },
  });

  if (!offer) {
    throw new TradeValidationError('Sell offer not found', 404);
  }

  if (offer.sellerUserId !== sellerUserId && !isStaffOrOwner) {
    throw new TradeValidationError('Unauthorized: Only the seller can withdraw this offer.', 403);
  }

  if (offer.status !== 'PENDING') {
    throw new TradeValidationError(`Offer is already ${offer.status} and cannot be withdrawn.`);
  }

  const updatedOffer = await prisma.exchangeSellOffer.update({
    where: { id: offer.id },
    data: {
      status: 'WITHDRAWN',
      respondedAt: new Date(),
    },
  });

  await logExchangeAudit({
    actorId: sellerUserId,
    action: 'EXCHANGE_SELL_OFFER_WITHDRAWN',
    entityType: 'EXCHANGE_SELL_OFFER',
    entityId: offer.id,
    newValues: {
      offerCode: offer.offerCode,
    },
  });

  return updatedOffer;
}

export interface CancelUnpaidTradeInput {
  tradeId: string;
  actorUserId: string;
  actorRoles: string[];
  reason?: string;
}

/**
 * Cancels an unpaid trade (AWAITING_PAYMENT), safely releases reserved capacity
 * back to the buy order, and restores buy order status from FULLY_RESERVED to ACTIVE or PARTIALLY_FILLED.
 */
export async function cancelUnpaidTrade(
  params: CancelUnpaidTradeInput
): Promise<ExchangeTrade> {
  const { tradeId, actorUserId, actorRoles, reason } = params;

  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
    include: { buyOrder: true },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  const isStaffOrOwner =
    actorRoles.includes('admin') ||
    actorRoles.includes('owner') ||
    actorRoles.includes('staff');

  const isParticipant =
    trade.buyerUserId === actorUserId || trade.sellerUserId === actorUserId;

  if (!isParticipant && !isStaffOrOwner) {
    throw new TradeValidationError('Unauthorized: Only trade participants or staff can cancel this trade.', 403);
  }

  if (trade.status !== 'AWAITING_PAYMENT') {
    throw new TradeValidationError(
      `Trade cannot be cancelled because its status is ${trade.status}. Only AWAITING_PAYMENT trades can be cancelled.`
    );
  }

  const updatedTrade = await prisma.$transaction(async (tx) => {
    // 1. Mark Trade CANCELLED and mark capacity released
    const updatedTrade = await tx.exchangeTrade.update({
      where: { id: trade.id },
      data: {
        status: 'CANCELLED',
        capacityReserved: false,
        cancelledByDiscordId: actorUserId,
        cancelReason: reason?.trim() || 'Cancelled prior to payment.',
      },
    });

    // 2. Safely release reserved capacity back to remaining capacity
    if (trade.capacityReserved) {
      const buyOrder = await tx.exchangeBuyOrder.findUnique({
        where: { id: trade.buyOrderId },
      });

      if (buyOrder) {
        const tradeQtyBig = BigInt(trade.quantityBaseUnits);
        const currReservedBig = BigInt(buyOrder.reservedCapacityBaseUnits);
        const currRemainingBig = BigInt(buyOrder.remainingCapacityBaseUnits);
        const totalCapacityBig = BigInt(buyOrder.totalCapacityBaseUnits);

        const newReservedBig = currReservedBig >= tradeQtyBig ? currReservedBig - tradeQtyBig : 0n;
        const newRemainingBig = currRemainingBig + tradeQtyBig;

        let nextOrderStatus = buyOrder.status;
        if (buyOrder.status === 'FULLY_RESERVED' || buyOrder.status === 'PARTIALLY_FILLED') {
          nextOrderStatus = newRemainingBig >= totalCapacityBig ? 'ACTIVE' : 'PARTIALLY_FILLED';
        }

        await tx.exchangeBuyOrder.update({
          where: { id: buyOrder.id },
          data: {
            reservedCapacityBaseUnits: newReservedBig.toString(),
            remainingCapacityBaseUnits: newRemainingBig.toString(),
            status: nextOrderStatus,
            version: { increment: 1 },
          },
        });

        // Record capacity released event
        await tx.exchangeTradeEvent.create({
          data: {
            tradeId: trade.id,
            eventType: 'CAPACITY_RELEASED',
            actorUserId: null,
            actorDiscordId: 'SYSTEM',
            actorRole: 'SYSTEM',
            note: `Released ${trade.quantityBaseUnits} base units back to buy order ${buyOrder.orderCode}. Remaining: ${newRemainingBig.toString()}`,
          },
        });
      }
    }

    // Determine actor role label
    let actorRoleLabel = 'SYSTEM';
    if (isStaffOrOwner) {
      actorRoleLabel = 'ADMIN';
    } else if (actorUserId === trade.buyerUserId) {
      actorRoleLabel = 'BUYER';
    } else if (actorUserId === trade.sellerUserId) {
      actorRoleLabel = 'SELLER';
    }

    // Record cancellation event
    await tx.exchangeTradeEvent.create({
      data: {
        tradeId: trade.id,
        eventType: 'TRADE_CANCELLED',
        actorUserId,
        actorDiscordId: actorUserId,
        actorRole: actorRoleLabel,
        fromStatus: 'AWAITING_PAYMENT',
        toStatus: 'CANCELLED',
        note: reason?.trim() || 'Trade cancelled prior to payment.',
      },
    });

    return updatedTrade;
  }, { timeout: 15000, maxWait: 10000 });

  await logExchangeAudit({
    actorId: actorUserId,
    action: 'EXCHANGE_TRADE_CANCELLED',
    entityType: 'EXCHANGE_TRADE',
    entityId: trade.id,
    newValues: {
      tradeCode: trade.tradeCode,
      buyOrderId: trade.buyOrderId,
      releasedQuantity: trade.quantityBaseUnits,
      reason: reason?.trim() || null,
    },
  });

  return updatedTrade;
}

/**
 * Lists all sell offers submitted on a specific Buy Order.
 * Accessible only by the order's buyer, staff, or owner.
 */
export async function listOffersOnBuyOrder(
  buyOrderId: string,
  viewerUserId: string,
  viewerRoles: string[]
): Promise<ExchangeSellOffer[]> {
  const buyOrder = await prisma.exchangeBuyOrder.findUnique({
    where: { id: buyOrderId },
  });

  if (!buyOrder) {
    throw new TradeValidationError('Buy order not found', 404);
  }

  const isStaffOrOwner =
    viewerRoles.includes('admin') ||
    viewerRoles.includes('owner') ||
    viewerRoles.includes('staff');

  if (buyOrder.buyerUserId !== viewerUserId && !isStaffOrOwner) {
    throw new TradeValidationError('Unauthorized: You can only view offers on your own buy orders.', 403);
  }

  return await prisma.exchangeSellOffer.findMany({
    where: { buyOrderId },
    include: {
      seller: {
        select: {
          discordId: true,
          username: true,
          displayName: true,
        },
      },
      deliveryMethod: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
      trade: {
        select: {
          id: true,
          tradeCode: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Lists all sell offers submitted by the authenticated seller.
 */
export async function listMySellOffers(
  sellerUserId: string
): Promise<ExchangeSellOffer[]> {
  return await prisma.exchangeSellOffer.findMany({
    where: { sellerUserId },
    include: {
      buyOrder: {
        include: {
          game: { select: { id: true, name: true, slug: true, iconUrl: true } },
          currency: { select: { id: true, name: true, unitLabel: true, unitMultiplier: true } },
          region: { select: { id: true, name: true, code: true } },
        },
      },
      deliveryMethod: {
        select: {
          id: true,
          name: true,
        },
      },
      trade: {
        select: {
          id: true,
          tradeCode: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Lists trades where the user is either the buyer or the seller.
 */
export async function listTrades(params: {
  userId: string;
  role?: 'buyer' | 'seller';
  status?: string;
}): Promise<ExchangeTrade[]> {
  const { userId, role, status } = params;

  const where: any = {};
  if (role === 'buyer') {
    where.buyerUserId = userId;
  } else if (role === 'seller') {
    where.sellerUserId = userId;
  } else {
    where.OR = [{ buyerUserId: userId }, { sellerUserId: userId }];
  }

  if (status) {
    where.status = status;
  }

  return await prisma.exchangeTrade.findMany({
    where,
    include: {
      game: { select: { id: true, name: true, slug: true, iconUrl: true } },
      currency: { select: { id: true, name: true, unitLabel: true, unitMultiplier: true } },
      region: { select: { id: true, name: true, code: true } },
      deliveryMethod: { select: { id: true, name: true } },
      buyOrder: { select: { id: true, orderCode: true } },
      seller: {
        select: {
          discordId: true,
          username: true,
          displayName: true,
        },
      },
      buyer: {
        select: {
          discordId: true,
          username: true,
          displayName: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Retrieves full trade details with immutable pricing snapshots, delivery method, and timeline events.
 * Accessible only by the buyer, seller, staff, or owner.
 */
export async function getTradeById(
  tradeIdOrCode: string,
  viewerUserId: string,
  viewerRoles: string[]
): Promise<any> {
  const trade = await prisma.exchangeTrade.findFirst({
    where: {
      OR: [{ id: tradeIdOrCode }, { tradeCode: tradeIdOrCode }],
    },
    include: {
      game: { select: { id: true, name: true, slug: true, iconUrl: true } },
      currency: { select: { id: true, name: true, unitLabel: true, unitMultiplier: true, decimalPrecision: true } },
      region: { select: { id: true, name: true, code: true } },
      deliveryMethod: { select: { id: true, name: true, description: true } },
      buyOrder: { select: { id: true, orderCode: true, instructions: true } },
      seller: {
        select: {
          discordId: true,
          username: true,
          displayName: true,
        },
      },
      buyer: {
        select: {
          discordId: true,
          username: true,
          displayName: true,
        },
      },
      events: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  const isStaffOrOwner =
    viewerRoles.includes('admin') ||
    viewerRoles.includes('owner') ||
    viewerRoles.includes('staff');

  const isParticipant =
    trade.buyerUserId === viewerUserId || trade.sellerUserId === viewerUserId;

  if (!isParticipant && !isStaffOrOwner) {
    throw new TradeValidationError('Unauthorized: You cannot view this trade.', 403);
  }

  return trade;
}
