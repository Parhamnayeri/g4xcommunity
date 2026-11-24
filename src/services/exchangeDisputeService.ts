/**
 * src/services/exchangeDisputeService.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 7:
 * Dispute & Refund Engine (exchange_disputes), Central Wallet Sync & Escrow Freezing.
 *
 * Strict Non-Negotiable Invariants:
 *  1. Strict No-Float Rule: ALL currency, refund, and payout values are exact integer USD cents (Int).
 *  2. Central Wallet & Ledger Synchronization: All refunds and partial payouts execute atomically
 *     against central Wallet/WalletV2 and record immutable LedgerTransaction records.
 *  3. Escrow Freezing: Opening a dispute immediately freezes escrow (FROZEN_DISPUTE) preventing
 *     any unilateral fund movement or buyer cancellation.
 *  4. 5 PRD Resolution Outcomes: RELEASE_TO_SELLER, FULL_REFUND_TO_BUYER, PARTIAL_REFUND,
 *     REQUEST_ADDITIONAL_PROOF, CANCEL_TRADE.
 *  5. Archive Only: Discord rooms are archived on trade conclusion, never deleted.
 */

import prisma from '../database/db';
import {
  ExchangeDispute,
  ExchangeTrade,
  ExchangeEscrow,
  ExchangeSettlement,
} from '@prisma/client';
import { TradeValidationError } from './exchangeTradeService';
import { logExchangeAudit } from './exchangeConfigService';
import { archiveExchangeDiscordRoom, getPublicWebUrl, buildTradeDisputeEmbed } from './exchangeDiscordService';
import { approveAndSettleExchangeTrade, generateNextSettlementCode } from './exchangeSettlementService';
import { getGlobalDiscordClient } from './orderDiscordService';
import { getSystemSetting } from './systemSettingService';
import { EmbedBuilder } from 'discord.js';

export const VALID_DISPUTE_CATEGORIES = [
  'BUYER_NOT_RECEIVED',
  'SELLER_CLAIMS_DELIVERED',
  'PARTIAL_DELIVERY',
  'INCORRECT_AMOUNT',
  'WRONG_REGION',
  'PAYMENT_ISSUE',
  'SUSPECTED_FRAUD',
  'OTHER',
] as const;

export type DisputeCategory = typeof VALID_DISPUTE_CATEGORIES[number];

export const VALID_RESOLUTION_OUTCOMES = [
  'RELEASE_TO_SELLER',
  'FULL_REFUND_TO_BUYER',
  'PARTIAL_REFUND',
  'REQUEST_ADDITIONAL_PROOF',
  'CANCEL_TRADE',
] as const;

export type DisputeResolutionOutcome = typeof VALID_RESOLUTION_OUTCOMES[number];

/**
 * Generates sequential human-readable dispute code: EXD-1001, EXD-1002, etc.
 */
export async function generateNextDisputeCode(tx: any = prisma): Promise<string> {
  const count = await tx.exchangeDispute.count();
  const candidate = `EXD-${1000 + count + 1}`;
  const exists = await tx.exchangeDispute.findUnique({
    where: { disputeCode: candidate },
  });
  if (!exists) return candidate;

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `EXD-${1000 + count + 1}-${randomSuffix}`;
}

/**
 * Sends an alert message to the configured exchange alert channel in Discord (if any).
 */
async function sendExchangeAlert(embed: EmbedBuilder): Promise<void> {
  const alertChannelId = await getSystemSetting(
    'exchange_alert_channel_id',
    process.env.DISCORD_EXCHANGE_ALERT_CHANNEL_ID || ''
  );

  if (!alertChannelId) return;

  const client = getGlobalDiscordClient();
  if (!client) return;

  try {
    const channel =
      client.channels?.cache?.get(alertChannelId) ||
      (await client.channels?.fetch?.(alertChannelId).catch(() => null));

    if (channel && typeof channel.send === 'function') {
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err: any) {
    console.warn('[ExchangeDispute] Failed to send alert to alertChannel:', err.message);
  }
}

/**
 * Sends a message into the trade's Discord room (if room exists).
 */
async function sendTradeRoomMessage(tradeId: string, embed: EmbedBuilder): Promise<void> {
  const room = await prisma.exchangeDiscordRoom.findUnique({
    where: { tradeId },
  });
  if (!room || room.status === 'ARCHIVED') return;

  const client = getGlobalDiscordClient();
  if (!client) return;

  try {
    const channel =
      client.channels?.cache?.get(room.channelId) ||
      (await client.channels?.fetch?.(room.channelId).catch(() => null));

    if (channel && typeof channel.send === 'function') {
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err: any) {
    console.warn('[ExchangeDispute] Failed to send message to trade room:', err.message);
  }
}

export interface OpenExchangeDisputeParams {
  tradeId: string;
  openedByUserId: string;
  openedByDiscordId: string;
  openedByRole: 'BUYER' | 'SELLER' | 'ADMIN' | 'OWNER';
  category: DisputeCategory;
  description: string;
  evidenceLinks?: string[];
}

/**
 * Opens a formal dispute on an active exchange trade.
 * Locks Escrow into FROZEN_DISPUTE status and transitions Trade to DISPUTED.
 */
export async function openExchangeDispute(params: OpenExchangeDisputeParams): Promise<ExchangeDispute> {
  const {
    tradeId,
    openedByUserId,
    openedByDiscordId,
    openedByRole,
    category,
    description,
    evidenceLinks = [],
  } = params;

  if (!VALID_DISPUTE_CATEGORIES.includes(category)) {
    throw new TradeValidationError(
      `Invalid dispute category '${category}'. Must be one of: ${VALID_DISPUTE_CATEGORIES.join(', ')}`,
      400
    );
  }

  if (!description || description.trim().length < 5) {
    throw new TradeValidationError('Dispute description must be at least 5 characters long.', 400);
  }

  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
    include: {
      escrow: true,
      buyer: true,
      seller: true,
      game: true,
      currency: true,
    },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  // Authorization check
  const isBuyer = trade.buyerUserId === openedByUserId || trade.buyerDiscordId === openedByDiscordId;
  const isSeller = trade.sellerUserId === openedByUserId || trade.sellerDiscordId === openedByDiscordId;
  const isStaff = ['ADMIN', 'OWNER'].includes(openedByRole);

  if (!isBuyer && !isSeller && !isStaff) {
    throw new TradeValidationError('Unauthorized: You are neither a participant nor staff for this trade.', 403);
  }

  if (['COMPLETED', 'CANCELLED'].includes(trade.status)) {
    throw new TradeValidationError(`Cannot open a dispute for a trade in status '${trade.status}'`, 400);
  }

  // Check if there is already an OPEN dispute for this trade
  const existingActiveDispute = await prisma.exchangeDispute.findFirst({
    where: {
      tradeId,
      status: { in: ['OPEN', 'UNDER_REVIEW', 'AWAITING_PROOF'] },
    },
  });

  if (existingActiveDispute) {
    throw new TradeValidationError(
      `An active dispute (${existingActiveDispute.disputeCode}) is already open for this trade.`,
      409
    );
  }

  const dispute = await prisma.$transaction(async (tx) => {
    const disputeCode = await generateNextDisputeCode(tx);

    const createdDispute = await tx.exchangeDispute.create({
      data: {
        disputeCode,
        tradeId,
        openedByUserId,
        openedByDiscordId,
        openedByRole,
        category,
        description: description.trim(),
        status: 'OPEN',
      },
    });

    // Update trade status to DISPUTED
    await tx.exchangeTrade.update({
      where: { id: tradeId },
      data: { status: 'DISPUTED' },
    });

    // Freeze Escrow
    if (trade.escrow) {
      await tx.exchangeEscrow.update({
        where: { id: trade.escrow.id },
        data: {
          status: 'FROZEN_DISPUTE',
          resolutionNote: `Dispute ${disputeCode} opened by ${openedByRole}: ${category}`,
        },
      });
    }

    // If evidence links provided, record as DISPUTE_EVIDENCE proof
    if (evidenceLinks.length > 0) {
      await tx.exchangeProof.create({
        data: {
          tradeId,
          submittedByUserId: openedByUserId,
          submittedByDiscordId: openedByDiscordId,
          submitterRole: openedByRole,
          proofType: 'DISPUTE_EVIDENCE',
          evidenceLinksJson: JSON.stringify(evidenceLinks),
          note: `Evidence for Dispute ${disputeCode}: ${description.slice(0, 100)}`,
          reviewStatus: 'PENDING',
        },
      });
    }

    // Trade event
    await tx.exchangeTradeEvent.create({
      data: {
        tradeId,
        eventType: 'DISPUTE_OPENED',
        actorUserId: openedByUserId,
        actorDiscordId: openedByDiscordId,
        actorRole: openedByRole,
        fromStatus: trade.status,
        toStatus: 'DISPUTED',
        note: `Dispute opened [${category}]: ${description}`,
        metadataJson: JSON.stringify({
          disputeId: createdDispute.id,
          disputeCode,
          category,
        }),
      },
    });

    // In-App Notification to Counterparty
    const counterpartyDiscordId = isBuyer ? trade.sellerDiscordId : trade.buyerDiscordId;
    const counterpartyRole = isBuyer ? 'SELLER' : 'BUYER';

    await tx.exchangeNotification.create({
      data: {
        recipientDiscordId: counterpartyDiscordId,
        recipientRole: counterpartyRole,
        tradeId,
        type: 'DISPUTE_OPENED',
        title: `🚨 Dispute Opened on Trade ${trade.tradeCode}`,
        message: `A dispute has been filed regarding Trade ${trade.tradeCode} under category '${category}'. Escrow funds are currently frozen pending staff review.`,
      },
    });

    // In-App Notification to Admin Team
    await tx.exchangeNotification.create({
      data: {
        recipientRole: 'ADMIN_TEAM',
        tradeId,
        type: 'DISPUTE_OPENED',
        title: `🚨 New Dispute Filed — ${trade.tradeCode} (${disputeCode})`,
        message: `${openedByRole} opened a dispute for Trade ${trade.tradeCode} [${category}]: "${description.slice(0, 80)}"`,
      },
    });

    return createdDispute;
  });

  await logExchangeAudit({
    actorId: openedByDiscordId,
    action: 'DISPUTE_OPENED',
    entityType: 'ExchangeDispute',
    entityId: dispute.id,
    previousValues: { tradeStatus: trade.status, escrowStatus: trade.escrow?.status },
    newValues: { disputeCode: dispute.disputeCode, category, status: 'OPEN' },
    reason: description,
  });

  const publicUrl = getPublicWebUrl();

  // Alert Discord Room
  const disputeEmbed = buildTradeDisputeEmbed(trade, description, openedByDiscordId, publicUrl);
  sendTradeRoomMessage(tradeId, disputeEmbed).catch(() => {});

  // Alert Admin Channel
  const alertEmbed = new EmbedBuilder()
    .setColor(0xd32f2f)
    .setTitle(`🚨 [DISPUTE ALERT] Trade ${trade.tradeCode} (${dispute.disputeCode})`)
    .setDescription(
      `Trade **${trade.tradeCode}** was disputed by <@${openedByDiscordId}> (${openedByRole}).\n` +
      `• **Category:** \`${category}\`\n` +
      `• **Description:** ${description}\n` +
      `• **Escrow Status:** \`FROZEN_DISPUTE\`\n\n` +
      `🔗 **[Intervene on Web Admin Portal](${publicUrl}/exchange/trades/${trade.id})**`
    )
    .setTimestamp();

  sendExchangeAlert(alertEmbed).catch(() => {});

  return dispute;
}

export interface ResolveExchangeDisputeParams {
  disputeId: string;
  adminUserId: string;
  adminDiscordId: string;
  outcome: DisputeResolutionOutcome;
  buyerRefundCents?: number;
  sellerPayoutCents?: number;
  note: string;
}

/**
 * Resolves an active dispute with one of the 5 PRD outcomes:
 *  1. RELEASE_TO_SELLER: Settle trade in full to seller.
 *  2. FULL_REFUND_TO_BUYER: Fully refund buyer, cancel trade, restore buy order capacity.
 *  3. PARTIAL_REFUND: Split cents between buyer & seller, record partial settlement, mark completed.
 *  4. REQUEST_ADDITIONAL_PROOF: Put dispute & trade into AWAITING_PROOF / ADDITIONAL_PROOF_REQUESTED.
 *  5. CANCEL_TRADE: Cancel trade with full refund or zero if unpaid.
 */
export async function resolveExchangeDispute(params: ResolveExchangeDisputeParams): Promise<ExchangeDispute> {
  const {
    disputeId,
    adminUserId,
    adminDiscordId,
    outcome,
    buyerRefundCents,
    sellerPayoutCents,
    note,
  } = params;

  if (!VALID_RESOLUTION_OUTCOMES.includes(outcome)) {
    throw new TradeValidationError(
      `Invalid resolution outcome '${outcome}'. Must be one of: ${VALID_RESOLUTION_OUTCOMES.join(', ')}`,
      400
    );
  }

  if (!note || note.trim().length < 5) {
    throw new TradeValidationError('Resolution note must be at least 5 characters explaining the decision.', 400);
  }

  const dispute = await prisma.exchangeDispute.findUnique({
    where: { id: disputeId },
    include: {
      trade: {
        include: {
          escrow: true,
          buyOrder: true,
          buyer: true,
          seller: true,
        },
      },
    },
  });

  if (!dispute) {
    throw new TradeValidationError('Dispute not found', 404);
  }

  if (['RESOLVED', 'CLOSED'].includes(dispute.status)) {
    throw new TradeValidationError(`Dispute is already ${dispute.status}.`, 409);
  }

  const trade = dispute.trade;
  const escrow = trade.escrow;

  const now = new Date();
  const publicUrl = getPublicWebUrl();

  // ─── OUTCOME 1: RELEASE_TO_SELLER ───────────────────────────────────────────
  if (outcome === 'RELEASE_TO_SELLER') {
    // Settle in full to seller via idempotent settlement service
    await approveAndSettleExchangeTrade({
      tradeId: trade.id,
      adminUserId,
      adminDiscordId,
      note: `Dispute ${dispute.disputeCode} resolved: Released to Seller. Note: ${note}`,
      settlementType: 'DISPUTE_RELEASE',
    });

    const updatedDispute = await prisma.exchangeDispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESOLVED',
        resolutionOutcome: 'RELEASE_TO_SELLER',
        resolutionSellerPayoutCents: trade.netSellerCents,
        resolutionBuyerRefundCents: 0,
        resolutionNote: note,
        resolvedByDiscordId: adminDiscordId,
        resolvedAt: now,
      },
    });

    return updatedDispute;
  }

  // ─── OUTCOME 2: FULL_REFUND_TO_BUYER ────────────────────────────────────────
  if (outcome === 'FULL_REFUND_TO_BUYER') {
    if (!escrow) {
      throw new TradeValidationError('Trade has no escrow record to refund.', 400);
    }

    if (escrow.releasedAt !== null) {
      throw new TradeValidationError('Escrow has already been released to seller.', 409);
    }

    if (escrow.refundedAt !== null) {
      throw new TradeValidationError('Escrow has already been refunded.', 409);
    }

    const refundAmountCents = escrow.reservedAmountCents;
    const txRefRefund = `TX_EXS_DISPUTE_REFUND_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const updatedDispute = await prisma.$transaction(async (tx) => {
      // 1. Credit Buyer Central Wallet
      if (escrow.fundingSource === 'WALLET') {
        await tx.wallet.update({
          where: { userId: trade.buyerUserId },
          data: {
            balanceUsd: { increment: refundAmountCents },
            reservedBalance: { decrement: refundAmountCents },
          },
        });

        const w2 = await tx.walletV2.findUnique({ where: { userId: trade.buyerUserId } });
        if (w2) {
          await tx.walletV2.update({
            where: { userId: trade.buyerUserId },
            data: {
              availableCents: { increment: refundAmountCents },
              reservedCents: { decrement: refundAmountCents },
            },
          });
        }
      } else {
        await tx.wallet.upsert({
          where: { userId: trade.buyerUserId },
          update: { balanceUsd: { increment: refundAmountCents } },
          create: {
            userId: trade.buyerUserId,
            balanceUsd: refundAmountCents,
          },
        });

        const w2 = await tx.walletV2.findUnique({ where: { userId: trade.buyerUserId } });
        if (w2) {
          await tx.walletV2.update({
            where: { userId: trade.buyerUserId },
            data: { availableCents: { increment: refundAmountCents } },
          });
        }
      }

      // 2. Ledger Transaction
      await tx.ledgerTransaction.create({
        data: {
          transactionRef: txRefRefund,
          userId: trade.buyerUserId,
          currency: 'USD',
          amountMinor: refundAmountCents,
          entryType: 'escrow_refund',
          status: 'posted',
          createdBy: adminDiscordId,
        },
      });

      // 3. Mark Escrow as REFUNDED
      await tx.exchangeEscrow.update({
        where: { id: escrow.id },
        data: {
          status: 'REFUNDED',
          refundedAmountCents: refundAmountCents,
          refundedAt: now,
          resolutionLedgerId: txRefRefund,
          resolutionNote: note,
        },
      });

      // 4. Restore BuyOrder Capacity
      if (trade.buyOrder) {
        const orderReservedBig = BigInt(trade.buyOrder.reservedCapacityBaseUnits || '0');
        const tradeQtyBig = BigInt(trade.quantityBaseUnits || '0');
        const orderRemBig = BigInt(trade.buyOrder.remainingCapacityBaseUnits || '0');

        const nextReserved = orderReservedBig > tradeQtyBig ? (orderReservedBig - tradeQtyBig).toString() : '0';
        const nextRem = (orderRemBig + tradeQtyBig).toString();

        await tx.exchangeBuyOrder.update({
          where: { id: trade.buyOrder.id },
          data: {
            reservedCapacityBaseUnits: nextReserved,
            remainingCapacityBaseUnits: nextRem,
            status: 'ACTIVE',
          },
        });
      }

      // 5. Cancel Trade
      await tx.exchangeTrade.update({
        where: { id: trade.id },
        data: {
          status: 'CANCELLED',
          cancelledByDiscordId: adminDiscordId,
          cancelReason: `Dispute resolved: full refund to buyer. Note: ${note}`,
        },
      });

      // 6. Update Dispute Record
      const resolved = await tx.exchangeDispute.update({
        where: { id: disputeId },
        data: {
          status: 'RESOLVED',
          resolutionOutcome: 'FULL_REFUND_TO_BUYER',
          resolutionBuyerRefundCents: refundAmountCents,
          resolutionSellerPayoutCents: 0,
          resolutionNote: note,
          resolvedByDiscordId: adminDiscordId,
          resolvedAt: now,
        },
      });

      // 7. Event & Notifications
      await tx.exchangeTradeEvent.create({
        data: {
          tradeId: trade.id,
          eventType: 'DISPUTE_RESOLVED_REFUND',
          actorUserId: adminUserId,
          actorDiscordId: adminDiscordId,
          actorRole: 'ADMIN',
          fromStatus: trade.status,
          toStatus: 'CANCELLED',
          note: `Dispute resolved in Buyer's favor. $${(refundAmountCents / 100).toFixed(2)} refunded. Reason: ${note}`,
        },
      });

      await tx.exchangeNotification.create({
        data: {
          recipientDiscordId: trade.buyerDiscordId,
          recipientRole: 'BUYER',
          tradeId: trade.id,
          type: 'DISPUTE_RESOLVED',
          title: '💵 Dispute Resolved — Full Refund Issued',
          message: `Dispute on Trade ${trade.tradeCode} was resolved in your favor. $${(refundAmountCents / 100).toFixed(2)} USD has been refunded to your wallet balance.`,
        },
      });

      await tx.exchangeNotification.create({
        data: {
          recipientDiscordId: trade.sellerDiscordId,
          recipientRole: 'SELLER',
          tradeId: trade.id,
          type: 'DISPUTE_RESOLVED',
          title: '⚠️ Dispute Resolved — Trade Cancelled',
          message: `Dispute on Trade ${trade.tradeCode} was resolved with a full refund to Buyer. Reason: ${note}`,
        },
      });

      return resolved;
    });

    await logExchangeAudit({
      actorId: adminDiscordId,
      action: 'DISPUTE_RESOLVED_FULL_REFUND',
      entityType: 'ExchangeDispute',
      entityId: disputeId,
      newValues: { outcome: 'FULL_REFUND_TO_BUYER', refundAmountCents, status: 'RESOLVED' },
      reason: note,
    });

    // Alert Discord Room & Archive channel
    const disputeResolvedEmbed = new EmbedBuilder()
      .setColor(0xff9800)
      .setTitle(`⚖️ Dispute Resolved: Full Refund to Buyer — ${trade.tradeCode}`)
      .setDescription(
        `Staff <@${adminDiscordId}> resolved the dispute in Buyer <@${trade.buyerDiscordId}>'s favor.\n` +
        `• **Refund Amount:** **$${(refundAmountCents / 100).toFixed(2)}** credited to Buyer.\n` +
        `• **Decision Note:** ${note}\n\n` +
        `🔒 *This trade channel will now be archived.*`
      )
      .setTimestamp();

    sendTradeRoomMessage(trade.id, disputeResolvedEmbed).catch(() => {});

    archiveExchangeDiscordRoom(trade.id, adminDiscordId, 'Dispute resolved with full refund to buyer')
      .catch((err) => console.warn(`[ExchangeDispute] Failed to archive channel for trade ${trade.id}:`, err.message));

    return updatedDispute;
  }

  // ─── OUTCOME 3: PARTIAL_REFUND ──────────────────────────────────────────────
  if (outcome === 'PARTIAL_REFUND') {
    if (!escrow) {
      throw new TradeValidationError('Trade has no escrow record for partial refund.', 400);
    }

    if (buyerRefundCents === undefined || sellerPayoutCents === undefined) {
      throw new TradeValidationError(
        'Both buyerRefundCents and sellerPayoutCents are strictly required for PARTIAL_REFUND outcome.',
        400
      );
    }

    if (buyerRefundCents < 0 || sellerPayoutCents < 0) {
      throw new TradeValidationError('Refund and payout amounts must be non-negative integers.', 400);
    }

    if (buyerRefundCents + sellerPayoutCents > escrow.reservedAmountCents) {
      throw new TradeValidationError(
        `Total allocated ($${((buyerRefundCents + sellerPayoutCents) / 100).toFixed(2)}) exceeds reserved escrow ($${(escrow.reservedAmountCents / 100).toFixed(2)}).`,
        400
      );
    }

    const txRefBuyer = `TX_EXS_PARTIAL_BUYER_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const txRefSeller = `TX_EXS_PARTIAL_SELLER_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const updatedDispute = await prisma.$transaction(async (tx) => {
      // 1. Buyer Refund Portion
      if (escrow.fundingSource === 'WALLET') {
        await tx.wallet.update({
          where: { userId: trade.buyerUserId },
          data: {
            balanceUsd: { increment: buyerRefundCents },
            reservedBalance: { decrement: escrow.reservedAmountCents },
          },
        });

        const w2 = await tx.walletV2.findUnique({ where: { userId: trade.buyerUserId } });
        if (w2) {
          await tx.walletV2.update({
            where: { userId: trade.buyerUserId },
            data: {
              availableCents: { increment: buyerRefundCents },
              reservedCents: { decrement: escrow.reservedAmountCents },
            },
          });
        }
      } else {
        if (buyerRefundCents > 0) {
          await tx.wallet.upsert({
            where: { userId: trade.buyerUserId },
            update: { balanceUsd: { increment: buyerRefundCents } },
            create: {
              userId: trade.buyerUserId,
              balanceUsd: buyerRefundCents,
            },
          });
        }
      }

      if (buyerRefundCents > 0) {
        await tx.ledgerTransaction.create({
          data: {
            transactionRef: txRefBuyer,
            userId: trade.buyerUserId,
            currency: 'USD',
            amountMinor: buyerRefundCents,
            entryType: 'escrow_refund',
            status: 'posted',
            createdBy: adminDiscordId,
          },
        });
      }

      // 2. Seller Payout Portion
      if (sellerPayoutCents > 0) {
        await tx.wallet.upsert({
          where: { userId: trade.sellerUserId },
          update: { balanceUsd: { increment: sellerPayoutCents } },
          create: {
            userId: trade.sellerUserId,
            balanceUsd: sellerPayoutCents,
          },
        });

        await tx.ledgerTransaction.create({
          data: {
            transactionRef: txRefSeller,
            userId: trade.sellerUserId,
            currency: 'USD',
            amountMinor: sellerPayoutCents,
            entryType: 'trade_settlement',
            status: 'posted',
            createdBy: adminDiscordId,
          },
        });
      }

      // 3. Mark Escrow as PARTIALLY_REFUNDED
      await tx.exchangeEscrow.update({
        where: { id: escrow.id },
        data: {
          status: 'PARTIALLY_REFUNDED',
          refundedAmountCents: buyerRefundCents,
          releasedAt: now,
          refundedAt: now,
          resolutionNote: note,
        },
      });

      // 4. Create Partial ExchangeSettlement Record
      const settlementCode = await generateNextSettlementCode(tx);
      await tx.exchangeSettlement.create({
        data: {
          settlementCode,
          tradeId: trade.id,
          escrowId: escrow.id,
          buyerUserId: trade.buyerUserId,
          sellerUserId: trade.sellerUserId,
          settlementType: 'PARTIAL_SETTLEMENT',
          grossValueCents: trade.grossValueCents,
          buyerCommissionCents: trade.buyerFeeCents,
          sellerCommissionCents: trade.sellerFeeCents,
          g4xTotalRevenueCents: escrow.reservedAmountCents - (buyerRefundCents + sellerPayoutCents),
          sellerNetPayoutCents: sellerPayoutCents,
          buyerRefundCents,
          buyerEscrowDebitLedgerId: txRefBuyer,
          sellerCreditLedgerId: txRefSeller,
          buyerRefundLedgerId: txRefBuyer,
          approvedByDiscordId: adminDiscordId,
          approvalNote: `Partial Settlement via Dispute ${dispute.disputeCode}: ${note}`,
          settledAt: now,
        },
      });

      // 5. Update Trade to COMPLETED
      await tx.exchangeTrade.update({
        where: { id: trade.id },
        data: {
          status: 'COMPLETED',
          finalApprovedAt: now,
          completedAt: now,
        },
      });

      // 6. Update Dispute Record
      const resolved = await tx.exchangeDispute.update({
        where: { id: disputeId },
        data: {
          status: 'RESOLVED',
          resolutionOutcome: 'PARTIAL_REFUND',
          resolutionBuyerRefundCents: buyerRefundCents,
          resolutionSellerPayoutCents: sellerPayoutCents,
          resolutionNote: note,
          resolvedByDiscordId: adminDiscordId,
          resolvedAt: now,
        },
      });

      // 7. Event & Notifications
      await tx.exchangeTradeEvent.create({
        data: {
          tradeId: trade.id,
          eventType: 'DISPUTE_RESOLVED_PARTIAL',
          actorUserId: adminUserId,
          actorDiscordId: adminDiscordId,
          actorRole: 'ADMIN',
          fromStatus: trade.status,
          toStatus: 'COMPLETED',
          note: `Dispute resolved via partial split. Buyer Refund: $${(buyerRefundCents / 100).toFixed(2)}, Seller Payout: $${(sellerPayoutCents / 100).toFixed(2)}.`,
        },
      });

      await tx.exchangeNotification.create({
        data: {
          recipientDiscordId: trade.buyerDiscordId,
          recipientRole: 'BUYER',
          tradeId: trade.id,
          type: 'DISPUTE_RESOLVED',
          title: '⚖️ Dispute Resolved — Partial Refund Issued',
          message: `Dispute on Trade ${trade.tradeCode} was resolved with a partial refund of $${(buyerRefundCents / 100).toFixed(2)} USD to your wallet balance.`,
        },
      });

      await tx.exchangeNotification.create({
        data: {
          recipientDiscordId: trade.sellerDiscordId,
          recipientRole: 'SELLER',
          tradeId: trade.id,
          type: 'DISPUTE_RESOLVED',
          title: '⚖️ Dispute Resolved — Partial Payout Released',
          message: `Dispute on Trade ${trade.tradeCode} was resolved with a partial payout of $${(sellerPayoutCents / 100).toFixed(2)} USD to your wallet balance.`,
        },
      });

      return resolved;
    });

    await logExchangeAudit({
      actorId: adminDiscordId,
      action: 'DISPUTE_RESOLVED_PARTIAL_REFUND',
      entityType: 'ExchangeDispute',
      entityId: disputeId,
      newValues: { outcome: 'PARTIAL_REFUND', buyerRefundCents, sellerPayoutCents, status: 'RESOLVED' },
      reason: note,
    });

    // Alert Discord Room & Archive channel
    const partialEmbed = new EmbedBuilder()
      .setColor(0x2196f3)
      .setTitle(`⚖️ Dispute Resolved: Partial Settlement — ${trade.tradeCode}`)
      .setDescription(
        `Staff <@${adminDiscordId}> resolved the dispute with a partial split:\n` +
        `• **Buyer Refund:** **$${(buyerRefundCents / 100).toFixed(2)}**\n` +
        `• **Seller Payout:** **$${(sellerPayoutCents / 100).toFixed(2)}**\n` +
        `• **Decision Note:** ${note}\n\n` +
        `🔒 *This trade channel will now be archived.*`
      )
      .setTimestamp();

    sendTradeRoomMessage(trade.id, partialEmbed).catch(() => {});

    archiveExchangeDiscordRoom(trade.id, adminDiscordId, 'Dispute resolved via partial refund')
      .catch((err) => console.warn(`[ExchangeDispute] Failed to archive channel for trade ${trade.id}:`, err.message));

    return updatedDispute;
  }

  // ─── OUTCOME 4: REQUEST_ADDITIONAL_PROOF ────────────────────────────────────
  if (outcome === 'REQUEST_ADDITIONAL_PROOF') {
    const updatedDispute = await prisma.$transaction(async (tx) => {
      const resolved = await tx.exchangeDispute.update({
        where: { id: disputeId },
        data: {
          status: 'AWAITING_PROOF',
          resolutionOutcome: 'REQUEST_ADDITIONAL_PROOF',
          resolutionNote: note,
        },
      });

      await tx.exchangeTrade.update({
        where: { id: trade.id },
        data: { status: 'ADDITIONAL_PROOF_REQUESTED' },
      });

      await tx.exchangeTradeEvent.create({
        data: {
          tradeId: trade.id,
          eventType: 'ADDITIONAL_PROOF_REQUESTED',
          actorUserId: adminUserId,
          actorDiscordId: adminDiscordId,
          actorRole: 'ADMIN',
          fromStatus: trade.status,
          toStatus: 'ADDITIONAL_PROOF_REQUESTED',
          note: `Staff requested additional evidence in dispute: ${note}`,
        },
      });

      await tx.exchangeNotification.create({
        data: {
          recipientDiscordId: trade.sellerDiscordId,
          recipientRole: 'SELLER',
          tradeId: trade.id,
          type: 'ADDITIONAL_PROOF_REQUESTED',
          title: '⚠️ Additional Evidence Needed for Dispute',
          message: `Staff investigating dispute ${dispute.disputeCode} has requested additional evidence: ${note}`,
        },
      });

      return resolved;
    });

    const roomEmbed = new EmbedBuilder()
      .setColor(0xff9800)
      .setTitle(`⚠️ Additional Proof Requested in Dispute — ${trade.tradeCode}`)
      .setDescription(
        `Staff <@${adminDiscordId}> requested more evidence regarding Dispute **${dispute.disputeCode}**.\n` +
        `• **Instructions:** ${note}\n\n` +
        `🔗 **[Upload Proof on Web Portal](${publicUrl}/exchange/trades/${trade.id})**`
      )
      .setTimestamp();

    sendTradeRoomMessage(trade.id, roomEmbed).catch(() => {});

    return updatedDispute;
  }

  // ─── OUTCOME 5: CANCEL_TRADE ────────────────────────────────────────────────
  if (outcome === 'CANCEL_TRADE') {
    // If trade was funded in escrow, refund in full; else cancel
    if (escrow && escrow.status !== 'RELEASED' && escrow.status !== 'REFUNDED') {
      return resolveExchangeDispute({
        disputeId,
        adminUserId,
        adminDiscordId,
        outcome: 'FULL_REFUND_TO_BUYER',
        note,
      });
    }

    const updatedDispute = await prisma.$transaction(async (tx) => {
      await tx.exchangeTrade.update({
        where: { id: trade.id },
        data: {
          status: 'CANCELLED',
          cancelledByDiscordId: adminDiscordId,
          cancelReason: `Dispute resolved: Trade cancelled by admin. Note: ${note}`,
        },
      });

      const resolved = await tx.exchangeDispute.update({
        where: { id: disputeId },
        data: {
          status: 'RESOLVED',
          resolutionOutcome: 'CANCEL_TRADE',
          resolutionNote: note,
          resolvedByDiscordId: adminDiscordId,
          resolvedAt: now,
        },
      });

      await tx.exchangeTradeEvent.create({
        data: {
          tradeId: trade.id,
          eventType: 'TRADE_CANCELLED',
          actorUserId: adminUserId,
          actorDiscordId: adminDiscordId,
          actorRole: 'ADMIN',
          fromStatus: trade.status,
          toStatus: 'CANCELLED',
          note: `Trade cancelled during dispute: ${note}`,
        },
      });

      return resolved;
    });

    archiveExchangeDiscordRoom(trade.id, adminDiscordId, 'Trade cancelled during dispute')
      .catch((err) => console.warn(`[ExchangeDispute] Failed to archive channel for trade ${trade.id}:`, err.message));

    return updatedDispute;
  }

  throw new TradeValidationError(`Unhandled outcome: ${outcome}`, 500);
}

/**
 * Gets a dispute by ID with all relations.
 */
export async function getExchangeDisputeById(disputeId: string): Promise<ExchangeDispute | null> {
  return prisma.exchangeDispute.findUnique({
    where: { id: disputeId },
    include: {
      trade: {
        include: {
          escrow: true,
          buyer: true,
          seller: true,
          game: true,
          currency: true,
        },
      },
    },
  });
}

/**
 * Gets active or latest dispute by trade ID.
 */
export async function getExchangeDisputeByTradeId(tradeId: string): Promise<ExchangeDispute | null> {
  return prisma.exchangeDispute.findFirst({
    where: { tradeId },
    orderBy: { createdAt: 'desc' },
  });
}

export interface ListDisputesFilter {
  status?: string;
  category?: string;
  tradeId?: string;
  page?: number;
  limit?: number;
}

/**
 * Lists disputes with pagination and optional filtering.
 */
export async function listExchangeDisputes(filter: ListDisputesFilter = {}): Promise<{
  disputes: any[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const page = Math.max(1, filter.page || 1);
  const limit = Math.max(1, Math.min(100, filter.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (filter.status) where.status = filter.status;
  if (filter.category) where.category = filter.category;
  if (filter.tradeId) where.tradeId = filter.tradeId;

  const [disputes, total] = await Promise.all([
    prisma.exchangeDispute.findMany({
      where,
      include: {
        trade: {
          include: {
            game: true,
            currency: true,
            buyer: { select: { discordId: true, username: true } },
            seller: { select: { discordId: true, username: true } },
          },
        },
        openedByUser: { select: { discordId: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.exchangeDispute.count({ where }),
  ]);

  return {
    disputes,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}
