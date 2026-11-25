/**
 * src/web/exchangeDashboardRoutes.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 8 (Final):
 * User Exchange Dashboard (Buyer & Seller Views),
 * and Independent Transaction Details API (16 PRD §12 Fields).
 *
 * Architectural Invariants:
 *  1. Central G4X Wallet & Ledger Unity: All balances (available, reserved, frozen)
 *     and financial audit trails read directly from central Wallet & LedgerTransaction.
 *  2. Zero Parallel Wallet Drift.
 *  3. Zero PII/KYC leakage: No phone, telegram, whatsapp, or KYC docs exposed to non-admins.
 *  4. RBAC: Transaction details strictly gated to Buyer, Seller, Admin, or Owner.
 */

import { Router, Request, Response } from 'express';
import prisma from '../database/db';
import { requireAuth, AuthenticatedRequest } from './middleware/auth';
import {
  getBuyerReputation,
  getSellerReputation,
  UserReputationSummary,
} from '../services/exchangeReputationService';
import { getExchangeEligibility } from '../services/exchangeAuthService';

export const exchangeDashboardRouter = Router();

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

/**
 * Format base units quantity into human readable string: 1000000 -> "1M", 5000 -> "5,000"
 */
function formatBaseQuantity(baseUnits: string, unitMultiplier: string, unitLabel: string): string {
  try {
    const qtyBig = BigInt(baseUnits);
    const mulBig = BigInt(unitMultiplier || '1');
    const units = mulBig > 0n ? qtyBig / mulBig : qtyBig;

    if (units >= 1_000_000_000n) {
      return `${(Number(units) / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B ${unitLabel}`;
    }
    if (units >= 1_000_000n) {
      return `${(Number(units) / 1_000_000).toFixed(1).replace(/\.0$/, '')}M ${unitLabel}`;
    }
    if (units >= 1_000n) {
      return `${(Number(units) / 1_000).toFixed(1).replace(/\.0$/, '')}K ${unitLabel}`;
    }
    return `${units.toLocaleString()} ${unitLabel}`;
  } catch {
    return `${baseUnits} ${unitLabel}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. BUYER DASHBOARD API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/exchange/dashboard/buyer
 * Returns comprehensive Buyer dashboard data, live reputation, central wallet balances,
 * and 7 categorized PRD §12 lists.
 */
exchangeDashboardRouter.get(
  '/api/exchange/dashboard/buyer',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const userId = user.discordId;

      // 1. Central Wallet live read
      const wallet = await prisma.wallet.findUnique({
        where: { userId },
      });

      const balanceUsd = wallet?.balanceUsd || 0;
      const reservedBalance = wallet?.reservedBalance || 0;
      const frozenBalance = wallet?.frozenBalance || 0;
      const availableBalance = Math.max(0, balanceUsd - reservedBalance - frozenBalance);
      const isFrozen = wallet?.isFrozen || false;

      // 2. Buyer Reputation & Eligibility live compute
      const [buyerRep, eligibility] = await Promise.all([
        getBuyerReputation(userId),
        getExchangeEligibility(userId),
      ]);

      const isExchanger = eligibility.hasExchangerRole;
      const kycStatus = eligibility.kycStatus || 'NONE';

      // 3. Fetch all Buy Orders for this Buyer
      const myBuyOrders = await prisma.exchangeBuyOrder.findMany({
        where: { buyerUserId: userId },
        include: {
          game: { select: { id: true, name: true, slug: true, iconUrl: true } },
          currency: { select: { id: true, name: true, slug: true, unitLabel: true, unitMultiplier: true } },
          region: { select: { id: true, name: true, code: true } },
          _count: { select: { trades: true, sellOffers: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      // 4. Fetch all Trades where user is Buyer
      const allBuyerTrades = await prisma.exchangeTrade.findMany({
        where: { buyerUserId: userId },
        include: {
          game: { select: { id: true, name: true, slug: true, iconUrl: true } },
          currency: { select: { id: true, name: true, unitLabel: true, unitMultiplier: true } },
          region: { select: { id: true, name: true, code: true } },
          deliveryMethod: { select: { id: true, name: true } },
          seller: { select: { discordId: true, username: true, displayName: true } },
          settlement: {
            select: {
              settlementCode: true,
              sellerNetPayoutCents: true,
              settledAt: true,
            },
          },
          payments: {
            select: {
              id: true,
              paymentCode: true,
              method: true,
              status: true,
              totalPayableCents: true,
              confirmedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          escrow: {
            select: {
              id: true,
              status: true,
              reservedAmountCents: true,
              fundingSource: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // 5. Categorize Trades into PRD §12 Sub-Tabs
      const activeTrades = allBuyerTrades.filter((t) =>
        ['PAYMENT_CONFIRMED', 'DELIVERY_IN_PROGRESS', 'PROOF_SUBMITTED', 'DISPUTED'].includes(t.status)
      );

      const completedTrades = allBuyerTrades.filter((t) => t.status === 'COMPLETED');

      const pendingPayments = allBuyerTrades.filter((t) => t.status === 'AWAITING_PAYMENT');

      const now = Date.now();
      const pendingApprovals = allBuyerTrades
        .filter((t) => t.status === 'AWAITING_FINAL_APPROVAL')
        .map((t) => {
          const waitReference = t.buyerConfirmedAt ? t.buyerConfirmedAt.getTime() : t.updatedAt.getTime();
          const waitingMinutes = Math.max(0, Math.round((now - waitReference) / (1000 * 60)));
          return {
            ...t,
            waitingMinutes,
          };
        });

      const cancelledTrades = allBuyerTrades.filter((t) => t.status === 'CANCELLED');
      const cancelledBuyOrders = myBuyOrders.filter((o) => o.status === 'CANCELLED');

      // 6. Aggregate Summary KPIs
      const activeBuyOrdersCount = myBuyOrders.filter((o) =>
        ['ACTIVE', 'PARTIALLY_FILLED'].includes(o.status)
      ).length;

      const totalSpentCents = completedTrades.reduce(
        (sum, t) => sum + (t.buyerTotalPayableCents || 0),
        0
      );

      res.json({
        success: true,
        summary: {
          activeBuyOrdersCount,
          activeTradesCount: activeTrades.length,
          completedTradesCount: completedTrades.length,
          pendingPaymentsCount: pendingPayments.length,
          pendingApprovalsCount: pendingApprovals.length,
          cancelledOrdersCount: cancelledBuyOrders.length + cancelledTrades.length,
          totalSpentCents,
          totalSpentUsd: (totalSpentCents / 100).toFixed(2),
          wallet: {
            balanceUsdCents: balanceUsd,
            balanceUsdFormatted: `$${(balanceUsd / 100).toFixed(2)}`,
            availableBalanceCents: availableBalance,
            availableBalanceFormatted: `$${(availableBalance / 100).toFixed(2)}`,
            reservedBalanceCents: reservedBalance,
            reservedBalanceFormatted: `$${(reservedBalance / 100).toFixed(2)}`,
            frozenBalanceCents: frozenBalance,
            isFrozen,
          },
          reputation: buyerRep,
          badge: {
            isExchanger,
            hasPrivilegedBuyerRole: eligibility.hasPrivilegedBuyerRole,
            kycStatus,
            canCreateBuyOrder: eligibility.canCreateBuyOrder,
          },
        },
        tabs: {
          myBuyOrders,
          activeTrades,
          completedTrades,
          pendingPayments,
          pendingApprovals,
          cancelledOrders: {
            cancelledBuyOrders,
            cancelledTrades,
          },
          tradeHistory: allBuyerTrades,
        },
      });
    } catch (error: any) {
      console.error('[ExchangeDashboard] Buyer dashboard error:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. SELLER DASHBOARD API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/exchange/dashboard/seller
 * Returns comprehensive Seller dashboard data, live reputation, currency volume breakdown,
 * central wallet balances, and categorized PRD §12 lists.
 */
exchangeDashboardRouter.get(
  '/api/exchange/dashboard/seller',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const userId = user.discordId;

      // 1. Central Wallet live read
      const wallet = await prisma.wallet.findUnique({
        where: { userId },
      });

      const balanceUsd = wallet?.balanceUsd || 0;
      const reservedBalance = wallet?.reservedBalance || 0;
      const frozenBalance = wallet?.frozenBalance || 0;
      const availableBalance = Math.max(0, balanceUsd - reservedBalance - frozenBalance);
      const isFrozen = wallet?.isFrozen || false;

      // 2. Seller Reputation live compute
      const sellerRep = await getSellerReputation(userId);

      // 3. Fetch all Sell Offers submitted by this Seller
      const mySellOffers = await prisma.exchangeSellOffer.findMany({
        where: { sellerUserId: userId },
        include: {
          buyOrder: {
            select: {
              id: true,
              orderCode: true,
              pricePerUnitCents: true,
              unitLabelSnapshot: true,
              unitMultiplierSnapshot: true,
              status: true,
              game: { select: { id: true, name: true, slug: true, iconUrl: true } },
              currency: { select: { id: true, name: true, slug: true, unitLabel: true } },
              buyer: { select: { discordId: true, username: true, displayName: true } },
            },
          },
          trade: {
            select: { id: true, tradeCode: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // 4. Fetch all Trades where user is Seller
      const allSellerTrades = await prisma.exchangeTrade.findMany({
        where: { sellerUserId: userId },
        include: {
          game: { select: { id: true, name: true, slug: true, iconUrl: true } },
          currency: { select: { id: true, name: true, unitLabel: true, unitMultiplier: true } },
          region: { select: { id: true, name: true, code: true } },
          deliveryMethod: { select: { id: true, name: true } },
          buyer: { select: { discordId: true, username: true, displayName: true } },
          settlement: {
            select: {
              settlementCode: true,
              sellerNetPayoutCents: true,
              settledAt: true,
            },
          },
          proofs: {
            select: { id: true, reviewStatus: true, createdAt: true },
          },
          escrow: {
            select: { id: true, status: true, reservedAmountCents: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // 5. Categorize Trades into PRD §12 Sub-Tabs
      const activeTrades = allSellerTrades.filter((t) =>
        [
          'AWAITING_PAYMENT',
          'PAYMENT_CONFIRMED',
          'DELIVERY_IN_PROGRESS',
          'PROOF_SUBMITTED',
          'AWAITING_FINAL_APPROVAL',
          'DISPUTED',
        ].includes(t.status)
      );

      const completedTrades = allSellerTrades.filter((t) => t.status === 'COMPLETED');

      // 6. Aggregate Volumes & Earnings
      // Total Currency Sold: aggregate by game + currency
      const volumeMap = new Map<
        string,
        { gameName: string; currencyName: string; unitLabel: string; totalBaseBig: bigint }
      >();

      for (const t of completedTrades) {
        const key = `${t.gameId}_${t.currencyId}`;
        const existing = volumeMap.get(key) || {
          gameName: t.game.name,
          currencyName: t.currency.name,
          unitLabel: t.currency.unitLabel,
          totalBaseBig: 0n,
        };
        try {
          existing.totalBaseBig += BigInt(t.quantityBaseUnits || '0');
        } catch {}
        volumeMap.set(key, existing);
      }

      const totalCurrencySold = Array.from(volumeMap.values()).map((v) => ({
        gameName: v.gameName,
        currencyName: v.currencyName,
        unitLabel: v.unitLabel,
        totalBaseUnits: v.totalBaseBig.toString(),
        formattedVolume: formatBaseQuantity(v.totalBaseBig.toString(), '1', v.unitLabel),
      }));

      // Total earnings from settled trades
      const totalEarningsCents = completedTrades.reduce(
        (sum, t) => sum + (t.settlement?.sellerNetPayoutCents || t.netSellerCents || 0),
        0
      );

      // Pending earnings from funded trades in progress
      const pendingTrades = activeTrades.filter((t) =>
        ['PAYMENT_CONFIRMED', 'DELIVERY_IN_PROGRESS', 'PROOF_SUBMITTED', 'AWAITING_FINAL_APPROVAL', 'DISPUTED'].includes(
          t.status
        )
      );
      const pendingEarningsCents = pendingTrades.reduce(
        (sum, t) => sum + (t.netSellerCents || 0),
        0
      );

      res.json({
        success: true,
        summary: {
          totalEarningsCents,
          totalEarningsUsd: (totalEarningsCents / 100).toFixed(2),
          pendingEarningsCents,
          pendingEarningsUsd: (pendingEarningsCents / 100).toFixed(2),
          activeTradesCount: activeTrades.length,
          completedTradesCount: completedTrades.length,
          totalOffersCount: mySellOffers.length,
          pendingOffersCount: mySellOffers.filter((o) => o.status === 'PENDING').length,
          totalCurrencySold,
          wallet: {
            balanceUsdCents: balanceUsd,
            balanceUsdFormatted: `$${(balanceUsd / 100).toFixed(2)}`,
            availableBalanceCents: availableBalance,
            availableBalanceFormatted: `$${(availableBalance / 100).toFixed(2)}`,
            reservedBalanceCents: reservedBalance,
            reservedBalanceFormatted: `$${(reservedBalance / 100).toFixed(2)}`,
            frozenBalanceCents: frozenBalance,
            isFrozen,
          },
          reputation: sellerRep,
        },
        tabs: {
          mySellOffers,
          activeTrades,
          completedTrades,
        },
      });
    } catch (error: any) {
      console.error('[ExchangeDashboard] Seller dashboard error:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. INDEPENDENT TRANSACTION DETAILS API (16 MANDATORY PRD §12 FIELDS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/exchange/transactions/:tradeId
 * Strictly gated to Trade Buyer, Seller, Admin, or Owner.
 * Returns ALL 16 mandatory PRD §12 fields cleanly structured with zero PII leakage.
 */
exchangeDashboardRouter.get(
  '/api/exchange/transactions/:tradeId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const userId = user.discordId;
      const { tradeId } = req.params;

      const trade = await prisma.exchangeTrade.findFirst({
        where: {
          OR: [{ id: tradeId }, { tradeCode: tradeId }],
        },
        include: {
          buyOrder: {
            select: {
              id: true,
              orderCode: true,
              instructions: true,
            },
          },
          game: { select: { id: true, name: true, slug: true, iconUrl: true } },
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
          region: { select: { id: true, name: true, code: true } },
          deliveryMethod: { select: { id: true, name: true, description: true } },
          buyer: {
            select: {
              discordId: true,
              username: true,
              displayName: true,
              createdAt: true,
            },
          },
          seller: {
            select: {
              discordId: true,
              username: true,
              displayName: true,
              createdAt: true,
            },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
          },
          escrow: true,
          proofs: {
            orderBy: { createdAt: 'asc' },
          },
          settlement: true,
          disputes: {
            orderBy: { createdAt: 'desc' },
          },
          discordRoom: true,
          events: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!trade) {
        res.status(404).json({ error: 'Not Found', message: 'Exchange trade not found' });
        return;
      }

      // RBAC Gate: Only Buyer, Seller, Staff, or Owner
      const isBuyer = trade.buyerUserId === userId || trade.buyerDiscordId === userId;
      const isSeller = trade.sellerUserId === userId || trade.sellerDiscordId === userId;
      const isStaff = isStaffOrOwner(user);

      if (!isBuyer && !isSeller && !isStaff) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Access Denied: You are not authorized to view transaction details for this trade.',
        });
        return;
      }

      // Fetch live reputation for Buyer & Seller
      const [buyerRep, sellerRep] = await Promise.all([
        getBuyerReputation(trade.buyerUserId),
        getSellerReputation(trade.sellerUserId),
      ]);

      // 10. Payment Method & Status Resolution
      const latestPayment = trade.payments[0] || null;
      const paymentMethod =
        latestPayment?.method || trade.escrow?.fundingSource || 'G4X_WALLET';

      // 14. Approval Status & Waiting Duration
      const now = Date.now();
      const waitingMinutes =
        trade.status === 'AWAITING_FINAL_APPROVAL' && trade.buyerConfirmedAt
          ? Math.max(0, Math.round((now - trade.buyerConfirmedAt.getTime()) / (1000 * 60)))
          : null;

      // 15. Settlement Details (Ledger IDs & sanitized revenue)
      let settlementDetails = null;
      if (trade.settlement) {
        settlementDetails = {
          settlementCode: trade.settlement.settlementCode,
          settlementType: trade.settlement.settlementType,
          sellerNetPayoutCents: trade.settlement.sellerNetPayoutCents,
          sellerNetPayoutUsd: `$${(trade.settlement.sellerNetPayoutCents / 100).toFixed(2)}`,
          buyerRefundCents: trade.settlement.buyerRefundCents,
          buyerRefundUsd: `$${(trade.settlement.buyerRefundCents / 100).toFixed(2)}`,
          // g4xTotalRevenueCents is visible only to Admin/Owner/Staff
          g4xTotalRevenueCents: isStaff ? trade.settlement.g4xTotalRevenueCents : undefined,
          g4xTotalRevenueUsd: isStaff ? `$${(trade.settlement.g4xTotalRevenueCents / 100).toFixed(2)}` : undefined,
          buyerEscrowDebitLedgerId: trade.settlement.buyerEscrowDebitLedgerId,
          sellerCreditLedgerId: trade.settlement.sellerCreditLedgerId,
          buyerRefundLedgerId: trade.settlement.buyerRefundLedgerId,
          settledAt: trade.settlement.settledAt,
        };
      }

      // 16 Mandatory PRD §12 Fields Response
      res.json({
        success: true,
        transaction: {
          // Field 1: tradeId & tradeCode
          tradeId: trade.id,
          tradeCode: trade.tradeCode,

          // Field 2: orderId & orderCode
          orderId: trade.buyOrderId,
          orderCode: trade.buyOrder.orderCode,

          // Field 3: buyer & seller (Zero PII, Live Reputation)
          buyer: {
            discordId: trade.buyer.discordId,
            username: trade.buyer.username,
            displayName: trade.buyer.displayName || trade.buyer.username,
            memberSince: trade.buyer.createdAt,
            reputation: buyerRep,
          },
          seller: {
            discordId: trade.seller.discordId,
            username: trade.seller.username,
            displayName: trade.seller.displayName || trade.seller.username,
            memberSince: trade.seller.createdAt,
            reputation: sellerRep,
          },

          // Field 4: game, currency, region
          game: trade.game,
          currency: trade.currency,
          region: trade.region,

          // Field 5: quantity (base units, display label, multiplier)
          quantity: {
            quantityBaseUnits: trade.quantityBaseUnits,
            unitLabel: trade.unitLabelSnapshot,
            unitMultiplier: trade.unitMultiplierSnapshot,
            formattedDisplay: formatBaseQuantity(
              trade.quantityBaseUnits,
              trade.unitMultiplierSnapshot,
              trade.unitLabelSnapshot
            ),
          },

          // Field 6: unitPriceCents
          unitPriceCents: trade.pricePerUnitCentsSnapshot,
          unitPriceUsd: `$${(trade.pricePerUnitCentsSnapshot / 100).toFixed(2)}`,

          // Field 7: grossValueCents
          grossValueCents: trade.grossValueCents,
          grossValueUsd: `$${(trade.grossValueCents / 100).toFixed(2)}`,

          // Field 8: buyerFeeCents (+ snapshot BPS)
          buyerFeeCents: trade.buyerFeeCents,
          buyerFeeUsd: `$${(trade.buyerFeeCents / 100).toFixed(2)}`,
          buyerCommissionBpsSnapshot: trade.buyerCommissionBpsSnapshot,

          // Field 9: sellerFeeCents (+ snapshot BPS)
          sellerFeeCents: trade.sellerFeeCents,
          sellerFeeUsd: `$${(trade.sellerFeeCents / 100).toFixed(2)}`,
          sellerCommissionBpsSnapshot: trade.sellerCommissionBpsSnapshot,
          netSellerCents: trade.netSellerCents,
          netSellerUsd: `$${(trade.netSellerCents / 100).toFixed(2)}`,
          buyerTotalPayableCents: trade.buyerTotalPayableCents,
          buyerTotalPayableUsd: `$${(trade.buyerTotalPayableCents / 100).toFixed(2)}`,

          // Field 10: paymentMethod
          paymentMethod,

          // Field 11: paymentStatus & details
          paymentStatus: {
            method: paymentMethod,
            status: latestPayment?.status || (trade.escrow ? 'CONFIRMED' : 'AWAITING_PAYMENT'),
            paymentCode: latestPayment?.paymentCode || null,
            confirmedAt: latestPayment?.confirmedAt || trade.escrow?.reservedAt || null,
            gatewayStatus: latestPayment?.gatewayStatus || null,
            totalPayableCents: latestPayment?.totalPayableCents || trade.buyerTotalPayableCents,
          },

          // Field 12: deliveryStatus, deliveryMethod, discordRoom
          deliveryStatus: {
            tradeStatus: trade.status,
            deliveryMethod: trade.deliveryMethod,
            estimatedDeliveryMinutes: trade.estimatedDeliveryMinutes,
            discordRoom: trade.discordRoom
              ? {
                  channelId: trade.discordRoom.channelId,
                  channelName: trade.discordRoom.channelName,
                  channelUrl: trade.discordRoom.channelUrl,
                  status: trade.discordRoom.status,
                  isArchived: trade.discordRoom.status === 'ARCHIVED',
                }
              : null,
          },

          // Field 13: proofs gallery
          proofs: trade.proofs.map((p) => ({
            id: p.id,
            submitterRole: p.submitterRole,
            proofType: p.proofType,
            fileUrl: p.fileUrl,
            evidenceLinks: (() => {
              try {
                return JSON.parse(p.evidenceLinksJson || '[]');
              } catch {
                return [];
              }
            })(),
            inGameDetails: p.inGameDetails,
            note: p.note,
            reviewStatus: p.reviewStatus,
            createdAt: p.createdAt,
          })),

          // Field 14: approvalStatus
          approvalStatus: {
            tradeStatus: trade.status,
            buyerConfirmedAt: trade.buyerConfirmedAt,
            finalApprovedAt: trade.finalApprovedAt,
            completedAt: trade.completedAt,
            waitingMinutes,
            isAwaitingFinalApproval: trade.status === 'AWAITING_FINAL_APPROVAL',
            dispute: trade.disputes[0]
              ? {
                  disputeCode: trade.disputes[0].disputeCode,
                  status: trade.disputes[0].status,
                  category: trade.disputes[0].category,
                  description: trade.disputes[0].description,
                  outcome: trade.disputes[0].resolutionOutcome,
                  resolvedAt: trade.disputes[0].resolvedAt,
                }
              : null,
          },

          // Field 15: settlementDetails
          settlementDetails,

          // Field 16: timeline
          timeline: trade.events.map((e) => ({
            id: e.id,
            eventType: e.eventType,
            actorRole: e.actorRole,
            actorDiscordId: e.actorDiscordId,
            fromStatus: e.fromStatus,
            toStatus: e.toStatus,
            note: e.note,
            metadata: (() => {
              try {
                return JSON.parse(e.metadataJson || '{}');
              } catch {
                return {};
              }
            })(),
            createdAt: e.createdAt,
          })),

          // Metadata & Permissions for viewer
          viewerContext: {
            isBuyer,
            isSeller,
            isStaff,
          },
          createdAt: trade.createdAt,
          updatedAt: trade.updatedAt,
        },
      });
    } catch (error: any) {
      console.error('[ExchangeDashboard] Transaction details error:', error);
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
);
