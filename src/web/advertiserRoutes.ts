/**
 * src/web/advertiserRoutes.ts — Dedicated Advertiser API Routes
 *
 * Provides dedicated endpoints for Advertisers (and Admin/Owner management):
 *  - GET  /api/advertiser/overview
 *  - POST /api/advertiser/deposits/intent (NOWPayments-ready hook)
 *  - POST /api/advertiser/withdrawals
 *  - GET  /api/advertiser/orders
 *  - POST /api/advertiser/orders
 *  - POST /api/advertiser/orders/:orderId/change-request
 */

import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../database/db';
import { requireAuth, AuthenticatedRequest } from './middleware/auth';
import {
  AdvertiserRank,
  ADVERTISER_RANK_LABELS,
  ADVERTISER_RANK_RATES_BPS,
  calculateRankCommission,
  formatBasisPoints,
  isValidAdvertiserRank,
  getRankBasisPoints,
} from '../services/advertiserRankService';
import { NowpaymentsClient } from '../services/payment/nowpaymentsClient';
import { getNowpaymentsConfig } from '../services/payment/paymentTypes';
import { getNowPaymentsService } from '../services/nowPaymentsService';
import { extractExternalOrderIdAndCleanNotes } from '../services/orderParsingUtils';
import { createAdvertiserBoostOrder } from '../services/orderLifecycleService';

export const advertiserRouter = Router();

// Middleware: Require advertiser or staff role
function requireAdvertiserOrStaff(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }

  const roles = (user.userRoles || []).map((r) => r.roleKey.toLowerCase());
  const isAdvertiser = roles.includes('advertiser');
  const isStaffOrAdmin = roles.some((r) => ['owner', 'manager', 'admin', 'staff'].includes(r));

  if (!isAdvertiser && !isStaffOrAdmin) {
    if (roles.includes('booster') || roles.includes('pilot')) {
      res.status(403).json({
        error: 'DEPOSIT_LOCKED_FOR_BOOSTER',
        message: 'Wallet deposits are locked for Booster accounts. Booster balances are credited automatically from completed orders and bonuses.',
      });
      return;
    }
    res.status(403).json({
      error: 'Forbidden',
      message: 'Access restricted to approved Advertisers or Management',
    });
    return;
  }

  next();
}

export const ADVERTISER_COMMISSION_TIERS = [
  {
    rank: 'BRONZE',
    label: 'Bronze Partner',
    rate: '14.99%',
    bps: 1499,
    description: 'Standard tier for newly registered advertisers',
  },
  {
    rank: 'SILVER',
    label: 'Silver Partner',
    rate: '12.99%',
    bps: 1299,
    description: 'Active commercial partners with verified track record',
  },
  {
    rank: 'GOLD',
    label: 'Gold Partner',
    rate: '10.99%',
    bps: 1099,
    description: 'High-volume community and agency partners',
  },
  {
    rank: 'DIAMOND',
    label: 'Diamond Partner',
    rate: '8.99%',
    bps: 899,
    description: 'Premier tier for top-tier agency volume',
  },
  {
    rank: 'FOUNDING_PARTNER',
    label: 'Founding Partner',
    rate: '8.99%',
    bps: 899,
    description: 'Exclusive tier for early G4X platform contributors',
  },
  {
    rank: 'OFFICIAL_PARTNER',
    label: 'Official Partner',
    rate: '6.99%',
    bps: 699,
    description: 'Enterprise tier with our lowest guaranteed commission rate',
  },
];

/**
 * Normalizes advertiser rank strings from either convention (e.g. FOUNDING_PARTNER vs FOUNDING_ADVERTISER)
 */
function normalizeRankToEnum(rankStr: string | null | undefined): AdvertiserRank {
  if (!rankStr) return AdvertiserRank.BRONZE;
  const upper = rankStr.trim().toUpperCase();
  if (upper === 'FOUNDING_PARTNER' || upper === 'FOUNDING_ADVERTISER') {
    return AdvertiserRank.FOUNDING_ADVERTISER;
  }
  if (upper === 'OFFICIAL_PARTNER' || upper === 'OFFICIAL_PARTNERS') {
    return AdvertiserRank.OFFICIAL_PARTNERS;
  }
  if (isValidAdvertiserRank(upper)) {
    return upper as AdvertiserRank;
  }
  return AdvertiserRank.BRONZE;
}

/**
 * 1. GET /api/advertiser/overview
 * Comprehensive dashboard overview: profile, rank tiers, live wallet balances, KPI metrics, recent activity
 */
advertiserRouter.get(
  ['/advertiser/overview', '/api/advertiser/overview'],
  requireAuth,
  requireAdvertiserOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const discordId = user.discordId;

      // 1. Fetch fresh user with wallet & payout preferences
      const fullUser = await prisma.user.findUnique({
        where: { discordId },
        include: {
          wallet: true,
          walletV2: true,
          payoutPreference: true,
          userRoles: true,
        },
      });

      if (!fullUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // 2. Rank & Commission
      const rankEnum = normalizeRankToEnum(fullUser.advertiserRank);
      const basisPoints = getRankBasisPoints(rankEnum);
      const commissionRate = formatBasisPoints(basisPoints);
      const rankLabel = ADVERTISER_RANK_LABELS[rankEnum] || `${rankEnum} (${commissionRate})`;

      // 3. Wallet Balances (USD floats derived from cents)
      const availableCents = fullUser.walletV2?.availableCents ?? fullUser.wallet?.balanceUsd ?? 0;
      const escrowCents = fullUser.walletV2?.reservedCents ?? fullUser.wallet?.escrowUsd ?? 0;
      const frozenCents = fullUser.wallet?.frozenBalance ?? fullUser.walletV2?.frozenCents ?? 0;
      const isFrozen = Boolean(fullUser.wallet?.isFrozen || fullUser.walletV2?.isFrozen);

      const wallet = {
        availableBalance: Math.round(availableCents) / 100,
        availableCents,
        pendingEscrowBalance: Math.round(escrowCents) / 100,
        pendingEscrowCents: escrowCents,
        frozenBalance: Math.round(frozenCents) / 100,
        frozenCents,
        isFrozen,
        payoutAddress:
          fullUser.payoutPreference?.cryptoAddress ||
          fullUser.payoutPreference?.bankIban ||
          null,
        payoutMethod: fullUser.payoutPreference?.cryptoAddress
          ? 'CRYPTO_BEP20'
          : fullUser.payoutPreference?.bankIban
          ? 'IRT_BANK'
          : null,
      };

      // 4. KPI Stats
      const [activeOrdersCount, completedOrdersCount, allAdvOrders] = await Promise.all([
        prisma.order.count({
          where: {
            OR: [
              { advertiserId: discordId },
              { creatorId: discordId, creatorType: 'advertiser' },
            ],
            status: { notIn: ['completed', 'cancelled', 'refunded'] },
          },
        }),
        prisma.order.count({
          where: {
            OR: [
              { advertiserId: discordId },
              { creatorId: discordId, creatorType: 'advertiser' },
            ],
            status: { in: ['completed', 'delivered'] },
          },
        }),
        prisma.order.findMany({
          where: {
            OR: [
              { advertiserId: discordId },
              { creatorId: discordId, creatorType: 'advertiser' },
            ],
          },
          select: { grossAmountMinor: true, status: true },
        }),
      ]);

      const totalSpentUsd =
        allAdvOrders
          .filter((o) => o.status !== 'cancelled' && o.status !== 'refunded')
          .reduce((sum, o) => sum + (o.grossAmountMinor || 0), 0) / 100;

      // 5. Recent Activity Records
      const [recentLedger, recentWithdrawals, recentDepositIntents, recentChangeRequests] = await Promise.all([
        prisma.ledgerEntryV2.findMany({
          where: { userId: discordId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.boosterWithdrawalRequest.findMany({
          where: { boosterId: discordId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.depositIntent.findMany({
          where: { userId: discordId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.orderChangeRequest.findMany({
          where: { requesterDiscordId: discordId },
          include: {
            order: { select: { id: true, orderRef: true, title: true, status: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      ]);

      const rankHierarchy = ADVERTISER_COMMISSION_TIERS.map((t) => ({
        rank: t.rank,
        label: t.label,
        basisPoints: t.bps,
        percentage: t.rate,
        description: t.description,
        isCurrent: t.rank === rankEnum,
      }));

      const userRolesList = fullUser.userRoles?.map((ur) => ur.roleKey) || ['advertiser'];

      res.json({
        success: true,
        profile: {
          discordId: fullUser.discordId,
          username: fullUser.username,
          displayName: fullUser.displayName || fullUser.username,
          advertiserRank: rankEnum,
          rankLabel,
          commissionRate,
          basisPoints,
          roles: userRolesList,
          isApprovedAdvertiser: true,
          isStaffOversight: false,
          applicationStatus: 'APPROVED',
          applicationDate: fullUser.createdAt,
        },
        rank: {
          currentRank: rankEnum,
          rankLabel,
          basisPoints,
          commissionPercent: commissionRate,
          rankHierarchy,
        },
        tiers: ADVERTISER_COMMISSION_TIERS,
        wallet,
        kpi: {
          activeOrdersCount,
          completedOrdersCount,
          totalSpentUsd: Math.round(totalSpentUsd * 100) / 100,
        },
        performance: {
          totalOrdersCreated: activeOrdersCount + completedOrdersCount,
          activeOrdersCount,
          completedOrdersCount,
          cancelledOrdersCount: 0,
          totalGrossVolumeUsd: totalSpentUsd.toFixed(2),
          totalPlatformFeesPaidUsd: '0.00',
        },
        discordIntegration: {
          guildId: process.env.DISCORD_GUILD_ID || null,
          ordersChannelId: null,
          becomeAdvChannelId: null,
          orderEntryUrl: null,
        },
        recentActivity: {
          ledger: recentLedger.map((l) => ({
            id: l.id,
            ref: l.entryRef,
            amountUsd: (l.amountCents / 100).toFixed(2),
            entryType: l.entryType,
            direction: l.direction,
            description: l.description,
            createdAt: l.createdAt,
          })),
          withdrawals: recentWithdrawals.map((w) => ({
            id: w.id,
            ref: w.withdrawalRef,
            amountUsd: (w.requestedUsdCents / 100).toFixed(2),
            status: w.status,
            payoutAddress: w.destinationAddress,
            payoutMethod: w.payoutMethod,
            createdAt: w.createdAt,
          })),
          deposits: recentDepositIntents.map((d) => ({
            id: d.id,
            ref: d.intentRef,
            amountUsd: d.amountUsd.toFixed(2),
            currency: d.payCurrency,
            status: d.status,
            invoiceUrl: d.invoiceUrl,
            createdAt: d.createdAt,
          })),
          changeRequests: recentChangeRequests.map((c) => ({
            id: c.id,
            orderId: c.orderId,
            orderRef: c.order?.orderRef,
            orderTitle: c.order?.title,
            requestType: c.requestType,
            reason: c.reason,
            status: c.status,
            reviewNote: c.reviewNote,
            createdAt: c.createdAt,
            reviewedAt: c.reviewedAt,
          })),
        },
        deposits: recentDepositIntents.map((d) => ({
          id: d.id,
          intentRef: d.intentRef,
          amountUsd: d.amountUsd,
          payCurrency: d.payCurrency,
          paymentId: d.paymentId,
          invoiceUrl: d.invoiceUrl,
          status: d.status,
          createdAt: d.createdAt,
          confirmedAt: d.confirmedAt,
        })),
      });
    } catch (err: any) {
      console.error('[AdvertiserOverview] Error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch advertiser overview' });
    }
  }
);

/**
 * 2. POST /api/advertiser/deposits/intent
 * Initiates a crypto deposit intent with NOWPayments hosted invoice or fallback
 */
advertiserRouter.post(
  ['/advertiser/deposits/intent', '/api/advertiser/deposits/intent'],
  requireAuth,
  requireAdvertiserOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { amountUsd, payCurrency } = req.body;

      const parsedAmount = parseFloat(String(amountUsd));
      if (isNaN(parsedAmount) || parsedAmount < 1) {
        res.status(400).json({ error: 'Deposit amount must be at least $1.00 USD' });
        return;
      }

      const selectedCurrency = (payCurrency || 'USDTTRC20').trim().toUpperCase();
      const intentRef = `DEP_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      const nowPaymentsService = getNowPaymentsService();
      const gatewayHealth = nowPaymentsService.getGatewayHealth();

      // Create DepositIntent in database first with baseline telemetry
      let depositIntent = await prisma.depositIntent.create({
        data: {
          intentRef,
          userId: user.discordId,
          provider: 'NOWPAYMENTS',
          isSandbox: gatewayHealth.isSandbox,
          amountUsd: parsedAmount,
          priceAmount: parsedAmount,
          payCurrency: selectedCurrency,
          status: 'WAITING',
          gatewayStatus: 'waiting',
          metadata: JSON.stringify({
            isSandbox: gatewayHealth.isSandbox,
            createdAt: new Date().toISOString(),
          }),
        },
      });

      const publicUrl = (process.env.PUBLIC_URL || process.env.APP_URL || '').replace(/\/+$/, '') || 'https://g4xcommunity.com';

      let paymentId: string | null = null;
      let invoiceUrl: string | null = null;
      let isConfigured = false;

      if (gatewayHealth.configured) {
        try {
          const invoiceResult = await nowPaymentsService.createInvoice({
            amountUsd: parsedAmount,
            payCurrency: selectedCurrency.toLowerCase(),
            orderId: String(depositIntent.id),
            description: `G4X Deposit #${depositIntent.id} ($${parsedAmount.toFixed(2)}) - ${user.username}`,
            ipnCallbackUrl: `${publicUrl}/api/webhooks/nowpayments`,
            successUrl: `${publicUrl}/advertiser?deposit=success`,
            cancelUrl: `${publicUrl}/advertiser?deposit=cancelled`,
          });

          if (invoiceResult && invoiceResult.invoice_url && (invoiceResult.invoice_url.startsWith('http://') || invoiceResult.invoice_url.startsWith('https://'))) {
            paymentId = String(invoiceResult.id || '');
            invoiceUrl = invoiceResult.invoice_url;
            isConfigured = true;

            depositIntent = await prisma.depositIntent.update({
              where: { id: depositIntent.id },
              data: {
                isSandbox: gatewayHealth.isSandbox,
                invoiceId: String(invoiceResult.id || ''),
                paymentId,
                invoiceUrl,
                priceAmount: parsedAmount,
                gatewayStatus: 'waiting',
                metadata: JSON.stringify({
                  nowpaymentsConfigured: true,
                  invoiceId: invoiceResult.id,
                  isSandbox: gatewayHealth.isSandbox,
                  createdAt: new Date().toISOString(),
                }),
              },
            });
          }
        } catch (npErr: any) {
          console.warn('[NOWPayments] Live invoice creation call failed, falling back to clean intent:', npErr?.message || npErr);
        }
      }

      const instructionsText = isConfigured && invoiceUrl
        ? `Send exactly $${parsedAmount.toFixed(2)} worth of ${selectedCurrency} via NOWPayments hosted portal.`
        : 'NOWPayments gateway API key is not configured on server yet. Invoice saved as WAITING for manual/admin approval or gateway activation.';

      const depositPayload = {
        id: depositIntent.id,
        intentRef: depositIntent.intentRef,
        amountUsd: depositIntent.amountUsd,
        payCurrency: depositIntent.payCurrency,
        status: depositIntent.status,
        invoiceUrl: invoiceUrl || null,
        paymentId: paymentId || null,
        instructions: instructionsText,
        createdAt: depositIntent.createdAt,
      };

      res.json({
        success: true,
        configured: isConfigured,
        invoiceUrl: invoiceUrl || null,
        deposit: depositPayload,
        depositIntent: depositPayload,
        instructions: {
          message: instructionsText,
          invoiceUrl: invoiceUrl || null,
          payCurrency: depositIntent.payCurrency,
          amountUsd: parsedAmount,
          provider: 'NOWPAYMENTS',
        },
        message: instructionsText,
      });
    } catch (err: any) {
      console.error('[AdvertiserDepositIntent] Error:', err);
      res.status(500).json({ error: err?.message || 'Failed to create deposit intent' });
    }
  }
);

/**
 * 2.1 POST /api/advertiser/deposits/:id/cancel
 * Cancels a WAITING deposit invoice for the requesting advertiser
 */
advertiserRouter.post(
  ['/advertiser/deposits/:id/cancel', '/api/advertiser/deposits/:id/cancel'],
  requireAuth,
  requireAdvertiserOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const depositId = parseInt(req.params.id, 10);
      if (isNaN(depositId)) {
        res.status(400).json({ error: 'INVALID_ID', message: 'Valid deposit ID is required.' });
        return;
      }

      const deposit = await prisma.depositIntent.findUnique({
        where: { id: depositId },
      });

      if (!deposit) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Deposit invoice not found.' });
        return;
      }

      // Verify ownership
      const userRoles = (user.userRoles || []).map((r) => String(r.roleKey).toLowerCase());
      const isStaff = userRoles.some((r) => ['admin', 'owner', 'manager'].includes(r));
      if (deposit.userId !== user.discordId && !isStaff) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'You are not authorized to cancel this deposit invoice.' });
        return;
      }

      if (deposit.status === 'CONFIRMED') {
        res.status(400).json({ error: 'ALREADY_CONFIRMED', message: 'Cannot cancel a confirmed deposit invoice.' });
        return;
      }

      if (deposit.status === 'CANCELLED') {
        res.status(400).json({ error: 'ALREADY_CANCELLED', message: 'This deposit invoice is already cancelled.' });
        return;
      }

      if (deposit.status === 'EXPIRED') {
        res.status(400).json({ error: 'EXPIRED', message: 'This deposit invoice has expired.' });
        return;
      }

      const updated = await prisma.depositIntent.update({
        where: { id: depositId },
        data: {
          status: 'CANCELLED',
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: 'Deposit invoice cancelled successfully.',
        deposit: {
          id: updated.id,
          intentRef: updated.intentRef,
          amountUsd: updated.amountUsd,
          payCurrency: updated.payCurrency,
          status: updated.status,
          invoiceUrl: updated.invoiceUrl,
          paymentId: updated.paymentId,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        },
      });
    } catch (err: any) {
      console.error('[AdvertiserDepositCancel] Error:', err);
      res.status(500).json({ error: err?.message || 'Failed to cancel deposit invoice' });
    }
  }
);

/**
 * 2.2 GET /api/advertiser/deposits
 * Lists all deposit invoices for the requesting advertiser
 */
advertiserRouter.get(
  ['/advertiser/deposits', '/api/advertiser/deposits'],
  requireAuth,
  requireAdvertiserOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const deposits = await prisma.depositIntent.findMany({
        where: { userId: user.discordId },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        deposits: deposits.map((d) => ({
          id: d.id,
          intentRef: d.intentRef,
          amountUsd: d.amountUsd,
          payCurrency: d.payCurrency,
          paymentId: d.paymentId,
          invoiceUrl: d.invoiceUrl,
          status: d.status,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          confirmedAt: d.confirmedAt,
        })),
      });
    } catch (err: any) {
      console.error('[AdvertiserDepositsList] Error:', err);
      res.status(500).json({ error: err?.message || 'Failed to fetch deposits' });
    }
  }
);

/**
 * 3. POST /api/advertiser/withdrawals
 * Requests withdrawal of available advertiser funds with atomic balance reservation
 */
advertiserRouter.post(
  ['/advertiser/withdrawals', '/api/advertiser/withdrawals'],
  requireAuth,
  requireAdvertiserOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { amount, payoutAddress, payoutMethod, notes } = req.body;

      const withdrawAmount = parseFloat(String(amount));
      if (isNaN(withdrawAmount) || withdrawAmount < 1) {
        res.status(400).json({ error: 'Minimum withdrawal amount is $1.00 USD' });
        return;
      }

      const amountCents = Math.round(withdrawAmount * 100);

      // Execute within atomic transaction
      const result = await prisma.$transaction(async (tx) => {
        // Fetch fresh wallet state
        const walletV2 = await tx.walletV2.findUnique({
          where: { userId: user.discordId },
        });
        const legacyWallet = await tx.wallet.findUnique({
          where: { userId: user.discordId },
        });

        const isFrozen = Boolean(walletV2?.isFrozen || legacyWallet?.isFrozen);
        if (isFrozen) {
          throw new Error('WALLET_FROZEN: Your wallet is currently frozen by management. Withdrawals are disabled.');
        }

        const availableCents = walletV2?.availableCents ?? legacyWallet?.balanceUsd ?? 0;
        if (availableCents < amountCents) {
          throw new Error(
            `INSUFFICIENT_FUNDS: Available balance ($${(availableCents / 100).toFixed(2)}) is less than requested withdrawal ($${withdrawAmount.toFixed(2)})`
          );
        }

        // Deduct from available, add to reserved
        await tx.walletV2.upsert({
          where: { userId: user.discordId },
          create: {
            userId: user.discordId,
            availableCents: Math.max(0, availableCents - amountCents),
            reservedCents: amountCents,
          },
          update: {
            availableCents: { decrement: amountCents },
            reservedCents: { increment: amountCents },
          },
        });

        if (legacyWallet) {
          await tx.wallet.update({
            where: { userId: user.discordId },
            data: {
              balanceUsd: { decrement: amountCents },
              escrowUsd: { increment: amountCents },
            },
          });
        }

        const withdrawalRef = `WTH_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const destinationAddress = (payoutAddress || '').trim();

        if (!destinationAddress) {
          throw new Error('MISSING_DESTINATION: A payout destination address or IBAN is required for withdrawal');
        }

        const withdrawal = await tx.boosterWithdrawalRequest.create({
          data: {
            withdrawalRef,
            boosterId: user.discordId,
            requestedUsdCents: amountCents,
            fixedFeeUsdCents: 0,
            netUsdCents: amountCents,
            quotedNetPayoutAmount: (amountCents / 100).toFixed(2),
            quotedCurrency: 'USD',
            payoutMethod: payoutMethod || 'USDT_BEP20',
            destinationAddress,
            status: 'REQUESTED',
          },
        });

        // Record double-entry ledger entry
        await tx.ledgerEntryV2.create({
          data: {
            entryRef: `LED_${withdrawalRef}`,
            accountType: 'USER_WALLET',
            userId: user.discordId,
            amountCents,
            entryType: 'WITHDRAWAL_RESERVE',
            direction: 'DEBIT',
            withdrawalRequestId: withdrawal.id,
            description: `Advertiser withdrawal request #${withdrawalRef} ($${withdrawAmount.toFixed(2)})`,
            createdBy: user.discordId,
          },
        });

        // Audit Log
        await tx.auditLog.create({
          data: {
            actorId: user.discordId,
            action: 'ADVERTISER_WITHDRAWAL_REQUESTED',
            entityType: 'WithdrawalRequest',
            entityId: String(withdrawal.id),
            newValues: JSON.stringify({
              withdrawalRef,
              amountUsd: withdrawAmount,
              destinationAddress,
            }),
          },
        });

        return withdrawal;
      });

      res.json({
        success: true,
        withdrawal: {
          id: result.id,
          ref: result.withdrawalRef,
          amountUsd: withdrawAmount.toFixed(2),
          status: result.status,
          payoutAddress: result.destinationAddress,
          createdAt: result.createdAt,
        },
        message: 'Withdrawal request submitted successfully and funds reserved.',
      });
    } catch (err: any) {
      console.error('[AdvertiserWithdrawal] Error:', err);
      res.status(400).json({ error: err.message || 'Failed to submit withdrawal request' });
    }
  }
);

/**
 * 4. GET /api/advertiser/orders
 * Returns all orders created by this Advertiser with full details and pending change requests
 */
advertiserRouter.get(
  ['/advertiser/orders', '/api/advertiser/orders'],
  requireAuth,
  requireAdvertiserOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const discordId = user.discordId;

      const orders = await prisma.order.findMany({
        where: {
          OR: [
            { advertiserId: discordId },
            { creatorId: discordId, creatorType: 'advertiser' },
          ],
        },
        include: {
          game: { select: { slug: true, displayName: true } },
          service: { select: { id: true, serviceKey: true, displayName: true, serviceMode: true } },
          runs: true,
          orderChannels: true,
          changeRequests: {
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { id: 'desc' },
        take: 100,
      });

      const formatted = orders.map((o) => {
        let specs: Record<string, any> = {};
        if (o.boostSpecsJson) {
          try {
            specs = JSON.parse(o.boostSpecsJson);
          } catch {
            specs = {};
          }
        }

        const activeChannel = o.orderChannels?.find((c) => c.status === 'active');
        const channelUrl = activeChannel?.discordChannelId
          ? `https://discord.com/channels/${activeChannel.discordGuildId || process.env.DISCORD_GUILD_ID || ''}/${activeChannel.discordChannelId}`
          : null;

        return {
          id: o.id,
          orderRef: o.orderRef,
          title: o.title || o.orderName || 'Order',
          game: o.game?.displayName || o.gameSlug,
          gameSlug: o.gameSlug,
          service: o.service?.displayName || 'Service',
          serviceId: o.serviceId,
          serviceMode: o.orderMode,
          status: o.status,
          paymentStatus: o.paymentStatus,
          grossAmountUsd: (o.grossAmountMinor / 100).toFixed(2),
          platformFeeUsd: (o.platformFeeMinor / 100).toFixed(2),
          boosterPoolUsd: (o.boosterPoolMinor / 100).toFixed(2),
          advertiserRank: o.advertiserRank,
          rankCommissionBps: o.rankCommissionBps,
          boostModel: o.boostModel,
          vpnRequirement: o.vpnRequirement,
          quantity: o.quantity,
          specs,
          notes: o.notes,
          discordChannelUrl: channelUrl,
          runsCount: o.runs?.length || 1,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
          pendingChangeRequest: o.changeRequests?.find((cr) => cr.status === 'PENDING') || null,
          allChangeRequests: o.changeRequests || [],
        };
      });

      res.json({
        success: true,
        orders: formatted,
      });
    } catch (err: any) {
      console.error('[AdvertiserOrders] Error:', err);
      res.status(500).json({ error: err.message || 'Failed to list advertiser orders' });
    }
  }
);

/**
 * 5. POST /api/advertiser/orders
 * Creates a new direct order with rank-based commission, dynamic specs, and atomic wallet reservation
 */
advertiserRouter.post(
  ['/advertiser/orders', '/api/advertiser/orders'],
  requireAuth,
  requireAdvertiserOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const {
        gameSlug,
        serviceId,
        title,
        boostSpecs,
        orderType = 'group',
        orderMode = 'non_pilot',
        runsCount = 1,
        vpnRequirement = 'No VPN Required (Self-Play)',
        notes = '',
        customerDiscord,
        customerDetails,
        grossAmountUsd,
        boosterPoolUsd,
        idempotencyKey,
      } = req.body;

      if (!gameSlug || !serviceId) {
        res.status(400).json({ error: 'Game and Service are required' });
        return;
      }

      const grossUsd = parseFloat(String(grossAmountUsd || boosterPoolUsd || 0));
      if (isNaN(grossUsd) || grossUsd <= 0) {
        res.status(400).json({ error: 'Gross order amount must be a positive number' });
        return;
      }

      const grossCents = Math.round(grossUsd * 100);

      // Clean & extract tags from notes
      const { externalOrderId: parsedOrderId, cleanNotes, title: parsedTitle } = extractExternalOrderIdAndCleanNotes(
        notes,
        null,
        title
      );

      // Delegate to authoritative createAdvertiserBoostOrder domain engine
      const createResult = await createAdvertiserBoostOrder({
        actorId: user.discordId,
        title: parsedTitle || title || 'New Order',
        boostModel: req.body.boostModel,
        vpnRequirement,
        boostSpecs: boostSpecs || undefined,
        gameSlug,
        serviceId: Number(serviceId),
        grossAmountMinor: grossCents,
        orderMode: orderMode === 'pilot' ? 'pilot' : 'non_pilot',
        runsCount: Math.max(1, parseInt(String(runsCount), 10) || 1),
        vpnLocation: req.body.vpnLocation,
        customerInfo: [customerDiscord, customerDetails].filter(Boolean).join(' | '),
        notes: cleanNotes || undefined,
        idempotencyKey,
        actionSource: 'web_portal',
      });

      // Update externalOrderId if parsed from notes
      if (parsedOrderId && createResult?.order?.id) {
        await prisma.order
          .update({
            where: { id: createResult.order.id },
            data: { externalOrderId: parsedOrderId },
          })
          .catch(() => {});
      }

      // Update boostSpecsJson if custom dynamic fields supplied
      if (boostSpecs && createResult?.order?.id) {
        await prisma.order
          .update({
            where: { id: createResult.order.id },
            data: { boostSpecsJson: JSON.stringify(boostSpecs) },
          })
          .catch(() => {});
      }

      res.json({
        success: true,
        order: {
          id: createResult.order.id,
          orderRef: createResult.order.orderRef,
          title: createResult.order.title || createResult.order.orderName,
          status: createResult.order.status,
          grossAmountUsd: (createResult.order.grossAmountMinor / 100).toFixed(2),
          boosterPoolUsd: (createResult.order.boosterPoolMinor / 100).toFixed(2),
          isFunded: createResult.isFunded,
        },
      });
    } catch (err: any) {
      console.error('[AdvertiserCreateOrder] Error:', err);
      res.status(400).json({ error: err.message || 'Failed to create order' });
    }
  }
);

/**
 * 6. POST /api/advertiser/orders/:orderId/change-request
 * Submits an EDIT or CANCEL request requiring explicit Admin/Owner review
 */
advertiserRouter.post(
  ['/advertiser/orders/:orderId/change-request', '/api/advertiser/orders/:orderId/change-request'],
  requireAuth,
  requireAdvertiserOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const orderId = parseInt(req.params.orderId, 10);
      const { requestType, proposedChanges, reason } = req.body;

      if (isNaN(orderId)) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const type = (requestType || '').trim().toUpperCase();
      if (type !== 'EDIT' && type !== 'CANCEL') {
        res.status(400).json({ error: "requestType must be either 'EDIT' or 'CANCEL'" });
        return;
      }

      const trimmedReason = (reason || '').trim();
      if (trimmedReason.length < 3) {
        res.status(400).json({ error: 'A mandatory reason of at least 3 characters is required' });
        return;
      }

      // Verify order exists and belongs to this advertiser (or caller is admin)
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { userRoles: false } as any,
      });

      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      const roles = (user.userRoles || []).map((r) => r.roleKey.toLowerCase());
      const isStaffOrAdmin = roles.some((r) => ['owner', 'manager', 'admin'].includes(r));
      const isOwner = order.advertiserId === user.discordId || order.creatorId === user.discordId;

      if (!isOwner && !isStaffOrAdmin) {
        res.status(403).json({ error: 'You do not have permission to manage this order' });
        return;
      }

      if (order.status === 'completed' || order.status === 'cancelled' || order.status === 'refunded') {
        res.status(400).json({ error: `Cannot request changes on an order that is already ${order.status}` });
        return;
      }

      // Check for an existing PENDING request on this order
      const existingPending = await prisma.orderChangeRequest.findFirst({
        where: {
          orderId,
          status: 'PENDING',
        },
      });

      if (existingPending) {
        res.status(400).json({
          error: 'An active change request is already pending administrator review for this order.',
          pendingRequestId: existingPending.id,
        });
        return;
      }

      // Create OrderChangeRequest record
      const changeRequest = await prisma.orderChangeRequest.create({
        data: {
          orderId,
          requesterDiscordId: user.discordId,
          requestType: type,
          proposedChangesJson: proposedChanges ? JSON.stringify(proposedChanges) : null,
          reason: trimmedReason,
          status: 'PENDING',
        },
      });

      // Audit Log
      await prisma.auditLog.create({
        data: {
          actorId: user.discordId,
          action: type === 'CANCEL' ? 'ADVERTISER_CANCEL_REQUESTED' : 'ADVERTISER_EDIT_REQUESTED',
          entityType: 'OrderChangeRequest',
          entityId: String(changeRequest.id),
          newValues: JSON.stringify({
            orderId,
            orderRef: order.orderRef,
            requestType: type,
            reason: trimmedReason,
          }),
        },
      });

      res.json({
        success: true,
        changeRequest: {
          id: changeRequest.id,
          orderId: changeRequest.orderId,
          requestType: changeRequest.requestType,
          status: changeRequest.status,
          reason: changeRequest.reason,
          createdAt: changeRequest.createdAt,
        },
        message:
          type === 'CANCEL'
            ? 'Cancellation request submitted successfully and queued for management approval.'
            : 'Order modification request submitted successfully and queued for management review.',
      });
    } catch (err: any) {
      console.error('[AdvertiserChangeRequest] Error:', err);
      res.status(500).json({ error: err.message || 'Failed to submit change request' });
    }
  }
);
